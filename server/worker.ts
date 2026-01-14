import { storage } from './storage';
import { log } from './index';
import { getStripeClientFactory } from './stripeClient';
import { sendDunningEmail, sendActionRequiredEmail, sendWeeklyDigest } from './email';
import type { ScheduledTask, UsageLog } from '@shared/schema';
import { PLANS } from '@shared/plans';

const POLL_INTERVAL_MS = 1000;
const ERROR_BACKOFF_MS = 5000;
const TASK_FOUND_DELAY_MS = 100;
const REPORT_USAGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WEEKLY_DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Quota guard helper - returns monthly email limit based on plan (centralized from @shared/plans)
function getPlanLimit(planId: string | null): number {
  const plan = planId ? PLANS[planId] : PLANS['default'];
  return plan?.limit ?? PLANS['default'].limit;
}

async function processTask(task: ScheduledTask): Promise<void> {
  switch (task.taskType) {
    case 'dunning_retry': {
      // QUOTA GUARD: Check usage limit before processing
      const merchant = await storage.getMerchant(task.merchantId);
      if (!merchant) {
        throw new Error(`Merchant ${task.merchantId} not found`);
      }

      const currentUsage = await storage.getMonthlyDunningCount(task.merchantId);
      const limit = getPlanLimit(merchant.subscriptionPlanId);

      if (currentUsage >= limit) {
        log(`Quota exceeded for merchant ${task.merchantId} (${currentUsage}/${limit}). Dropping task ${task.id}.`, 'worker', 'warn');
        await storage.updateTaskStatus(task.id, 'failed');
        await storage.createUsageLog({
          merchantId: task.merchantId,
          metricType: 'quota_exceeded',
          amount: 1,
        });
        return; // STOP EXECUTION - don't send email
      }

      const factory = await getStripeClientFactory();
      const stripe = await factory.getClient(task.merchantId);
      
      const payload = task.payload as { invoiceId: string; attemptCount?: number };
      
      const invoice = await stripe.invoices.retrieve(payload.invoiceId);
      
      if (invoice.status === 'paid' || invoice.status === 'void') {
        log(`Invoice ${payload.invoiceId} already resolved (status: ${invoice.status})`, 'worker');
        return;
      }
      
      if (invoice.status === 'open') {
        const customerEmail = typeof invoice.customer_email === 'string' 
          ? invoice.customer_email 
          : null;
        
        if (!customerEmail) {
          log(`No customer email for invoice ${payload.invoiceId}, skipping dunning`, 'worker');
          return;
        }
        
        // Fetch failure-specific template for this attempt (if defined)
        const attemptCount = payload.attemptCount || 1;
        const template = await storage.getEmailTemplate(merchant.id, attemptCount);
        
        // Create usage log FIRST to get logId for tracking (Ticket 23.3)
        const usageLog = await storage.createUsageLog({
          merchantId: task.merchantId,
          metricType: 'dunning_email_sent',
          amount: 1,
        });
        
        const emailSent = await sendDunningEmail(customerEmail, {
          invoiceId: payload.invoiceId,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
          attemptCount,
          merchantId: task.merchantId,
          merchant, // Pass branding identity
          customTemplate: template ? { subject: template.subject, body: template.body } : undefined,
          logId: usageLog.id, // Pass logId for tracking
        });
        
        if (emailSent) {
          log(`Dunning email sent and usage logged for merchant ${task.merchantId} (logId: ${usageLog.id})`, 'worker');
        } else {
          throw new Error('Failed to send dunning email');
        }
      }
      break;
    }
    
    case 'report_usage': {
      await processReportUsage(task);
      break;
    }
    
    case 'notify_action_required': {
      log(`Processing action required notification for merchant ${task.merchantId}`, 'worker');
      const factory = await getStripeClientFactory();
      const stripe = await factory.getClient(task.merchantId);
      
      const payload = task.payload as { invoiceId: string; hostedInvoiceUrl?: string };
      
      const invoice = await stripe.invoices.retrieve(payload.invoiceId);
      
      const customerEmail = typeof invoice.customer_email === 'string' 
        ? invoice.customer_email 
        : null;
      
      if (!customerEmail) {
        log(`No customer email for invoice ${payload.invoiceId}, skipping action required notification`, 'worker');
        return;
      }
      
      const emailSent = await sendActionRequiredEmail(customerEmail, {
        invoiceId: payload.invoiceId,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        hostedInvoiceUrl: payload.hostedInvoiceUrl || invoice.hosted_invoice_url,
        merchantId: task.merchantId,
      });
      
      if (emailSent) {
        // Log usage for action required emails (same as dunning emails)
        await storage.createUsageLog({
          merchantId: task.merchantId,
          metricType: 'dunning_email_sent',
          amount: 1,
        });
        log(`Action required email sent for invoice ${payload.invoiceId}`, 'worker');
      } else {
        throw new Error('Failed to send action required email');
      }
      break;
    }
    
    case 'send_weekly_digest': {
      await processWeeklyDigest(task);
      break;
    }
    
    default:
      log(`Unknown task type: ${task.taskType}`, 'worker');
  }
}

async function processReportUsage(task: ScheduledTask): Promise<void> {
  try {
    log('Starting usage report cycle...', 'worker');
    
    const pendingLogs = await storage.getPendingUsageLogs(100);
    
    if (pendingLogs.length === 0) {
      log('No pending usage logs to report', 'worker');
    } else {
      const byMerchant = new Map<string, UsageLog[]>();
      for (const logEntry of pendingLogs) {
        const existing = byMerchant.get(logEntry.merchantId) || [];
        existing.push(logEntry);
        byMerchant.set(logEntry.merchantId, existing);
      }
      
      log(`Found ${pendingLogs.length} pending usage logs across ${byMerchant.size} merchants`, 'worker');
      
      const factory = await getStripeClientFactory();
      const reportedIds: number[] = [];
      
      for (const [merchantId, logs] of Array.from(byMerchant.entries())) {
        try {
          const merchant = await storage.getMerchant(merchantId);
          if (!merchant?.stripeConnectId || !merchant?.stripeCustomerId) {
            log(`Merchant ${merchantId} missing Stripe Connect ID or Customer ID, skipping`, 'worker');
            continue;
          }
          
          // CRITICAL FIX: Use Platform Client for meter events
          // Meter events belong to the Platform Subscription, not the Connected Account.
          // Using getClient(merchantId) causes a resource_missing error from Stripe.
          const stripe = await factory.getPlatformClient();
          
          for (const logEntry of logs) {
            if (logEntry.metricType !== 'dunning_email_sent') {
              reportedIds.push(logEntry.id);
              continue;
            }
            
            // RACE GUARD: Re-check quota immediately before Stripe call
            // This minimizes the race window from milliseconds to microseconds
            const currentUsage = await storage.getMonthlyDunningCount(merchant.id);
            const plan = PLANS[merchant.subscriptionPlanId || ''] || PLANS['default'];
            
            if (currentUsage >= plan.limit) {
              log(`[Race Guard] Quota exceeded for merchant ${merchant.id} (${currentUsage}/${plan.limit}). Skipping log ${logEntry.id}.`, 'worker', 'warn');
              reportedIds.push(logEntry.id); // Mark as processed to remove from queue
              continue;
            }
            
            try {
              const idempotencyKey = `usage_log_${logEntry.id}`;
              
              await stripe.billing.meterEvents.create({
                event_name: 'dunning_email_sent',
                payload: {
                  value: String(logEntry.amount),
                  stripe_customer_id: merchant.stripeCustomerId,
                },
              }, {
                idempotencyKey,
              });
              
              reportedIds.push(logEntry.id);
              log(`Reported usage log ${logEntry.id} to Stripe`, 'worker');
            } catch (stripeError: any) {
              if (stripeError.code === 'idempotency_key_in_use') {
                reportedIds.push(logEntry.id);
                log(`Usage log ${logEntry.id} already reported (idempotent)`, 'worker');
              } else {
                // POISON PILL HANDLING: Detect permanent vs transient errors
                // Permanent errors (4xx) will never succeed on retry - skip them to unblock the queue
                const isPermanent = 
                  stripeError.type === 'StripeInvalidRequestError' || 
                  stripeError.statusCode === 400 || 
                  stripeError.statusCode === 404 ||
                  (stripeError.code && stripeError.code.startsWith('resource_'));

                if (isPermanent) {
                  log(`Poison Pill: Usage log ${logEntry.id} failed permanently: ${stripeError.message}. Skipping.`, 'worker', 'error');
                  reportedIds.push(logEntry.id); // Remove from queue
                } else {
                  // Transient error (Network, 500, Rate Limit) - will be retried next tick
                  log(`Transient usage reporting error for log ${logEntry.id}: ${stripeError.message}`, 'worker', 'warn');
                }
              }
            }
          }
        } catch (merchantError: any) {
          log(`Error processing merchant ${merchantId}: ${merchantError.message}`, 'worker');
        }
      }
      
      if (reportedIds.length > 0) {
        await storage.markUsageAsReported(reportedIds);
        log(`Marked ${reportedIds.length} usage logs as reported`, 'worker');
      }
    }
  } finally {
    // IMMORTAL WORKER: Always schedule next run, even if work fails
    const runAt = new Date(Date.now() + REPORT_USAGE_INTERVAL_MS);
    await storage.createTask({
      merchantId: 'system',
      taskType: 'report_usage',
      payload: { scheduledBy: 'reporter_cycle' },
      status: 'pending',
      runAt,
    });
    
    log(`Scheduled next report_usage task at ${runAt.toISOString()}`, 'worker');
  }
}

async function processWeeklyDigest(task: ScheduledTask): Promise<void> {
  try {
    log(`Processing weekly digest for merchant ${task.merchantId}`, 'worker');
    
    const merchant = await storage.getMerchant(task.merchantId);
    if (!merchant) {
      log(`Merchant ${task.merchantId} not found, skipping weekly digest`, 'worker');
      return;
    }
    
    if (!merchant.email) {
      log(`Merchant ${task.merchantId} has no email, skipping weekly digest`, 'worker');
      return;
    }
    
    const weeklyMetrics = await storage.getWeeklyMetrics(task.merchantId);
    
    const emailSent = await sendWeeklyDigest(merchant.email, {
      totalRecoveredCents: weeklyMetrics.totalRecoveredCents,
      totalEmailsSent: weeklyMetrics.totalEmailsSent,
      totalOpens: weeklyMetrics.totalOpens,
      totalClicks: weeklyMetrics.totalClicks,
      merchantId: task.merchantId,
    });
    
    if (emailSent) {
      log(`Weekly digest sent to ${merchant.email}`, 'worker');
    } else {
      throw new Error('Failed to send weekly digest email');
    }
  } finally {
    // IMMORTAL WORKER: Always schedule next run, even if work fails
    const runAt = new Date(Date.now() + WEEKLY_DIGEST_INTERVAL_MS);
    await storage.createTask({
      merchantId: task.merchantId,
      taskType: 'send_weekly_digest',
      payload: { scheduledBy: 'digest_cycle' },
      status: 'pending',
      runAt,
    });
    
    log(`Scheduled next weekly digest at ${runAt.toISOString()}`, 'worker');
  }
}

// WATCHDOG: Ensure critical system tasks are always running
// This protects against DB glitches that break chain-reaction scheduling
async function ensureSystemTasks(): Promise<void> {
  try {
    log('Watchdog: Checking for missing system tasks...', 'worker');
    
    // Check for global report_usage task (system merchant)
    const hasReporter = await storage.hasReportUsageTask();
    if (!hasReporter) {
      await storage.createTask({
        merchantId: 'system',
        taskType: 'report_usage',
        payload: { scheduledBy: 'watchdog' },
        status: 'pending',
        runAt: new Date(),
      });
      log('Watchdog: Resurrected global report_usage task', 'worker', 'warn');
    }
    
    // Check for weekly digest tasks for all real merchants
    const merchants = await storage.getMerchants();
    for (const merchant of merchants) {
      // Skip the system merchant
      if (merchant.id === 'system') continue;
      
      const hasDigest = await storage.hasWeeklyDigestTask(merchant.id);
      if (!hasDigest) {
        await storage.createTask({
          merchantId: merchant.id,
          taskType: 'send_weekly_digest',
          payload: { scheduledBy: 'watchdog' },
          status: 'pending',
          runAt: new Date(),
        });
        log(`Watchdog: Resurrected weekly_digest for ${merchant.id}`, 'worker', 'warn');
      }
    }
    
    log('Watchdog: System task check complete', 'worker');
  } catch (error: any) {
    log(`Watchdog Error: ${error.message}`, 'worker', 'error');
  }
}

export function startWorker(): void {
  log('Worker starting...', 'worker');
  
  // Boot the Watchdog to ensure critical tasks exist
  ensureSystemTasks();

  async function run(): Promise<void> {
    try {
      const task = await storage.claimNextTask();

      if (task) {
        log(`Claimed task ${task.id} type ${task.taskType}`, 'worker');
        
        try {
          await processTask(task);
          await storage.updateTaskStatus(task.id, 'completed');
          log(`Task ${task.id} completed successfully`, 'worker');
        } catch (taskError: any) {
          log(`Task ${task.id} processing error: ${taskError.message}`, 'worker');
          await storage.updateTaskStatus(task.id, 'failed');
          log(`Task ${task.id} marked as failed`, 'worker');
        }
        
        setTimeout(run, TASK_FOUND_DELAY_MS);
      } else {
        setTimeout(run, POLL_INTERVAL_MS);
      }
    } catch (error: any) {
      log(`Worker error: ${error.message}`, 'worker');
      setTimeout(run, ERROR_BACKOFF_MS);
    }
  }

  run();
  log('Worker loop initialized', 'worker');
}
