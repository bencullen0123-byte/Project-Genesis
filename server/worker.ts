import { storage } from './storage';
import { log } from './index';
import { getStripeClientFactory } from './stripeClient';
import { sendDunningEmail, sendActionRequiredEmail, sendWeeklyDigest } from './email';
import type { ScheduledTask, UsageLog } from '@shared/schema';

const POLL_INTERVAL_MS = 1000;
const ERROR_BACKOFF_MS = 5000;
const TASK_FOUND_DELAY_MS = 100;
const REPORT_USAGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WEEKLY_DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function processTask(task: ScheduledTask): Promise<void> {
  switch (task.taskType) {
    case 'dunning_retry': {
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
        
        const emailSent = await sendDunningEmail(customerEmail, {
          invoiceId: payload.invoiceId,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
          attemptCount: payload.attemptCount,
          merchantId: task.merchantId,
        });
        
        if (emailSent) {
          await storage.createUsageLog({
            merchantId: task.merchantId,
            metricType: 'dunning_email_sent',
            amount: 1,
          });
          
          log(`Dunning email sent and usage logged for merchant ${task.merchantId}`, 'worker');
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
        if (!merchant?.stripeConnectId) {
          log(`Merchant ${merchantId} has no Stripe Connect ID, skipping`, 'worker');
          continue;
        }
        
        const stripe = await factory.getClient(merchantId);
        
        for (const logEntry of logs) {
          if (logEntry.metricType !== 'dunning_email_sent') {
            reportedIds.push(logEntry.id);
            continue;
          }
          
          try {
            const idempotencyKey = `usage_log_${logEntry.id}`;
            
            await stripe.billing.meterEvents.create({
              event_name: 'dunning_email_sent',
              payload: {
                value: String(logEntry.amount),
                stripe_customer_id: merchant.stripeConnectId,
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
              log(`Failed to report usage log ${logEntry.id}: ${stripeError.message}`, 'worker');
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

async function processWeeklyDigest(task: ScheduledTask): Promise<void> {
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
    merchantId: task.merchantId,
  });
  
  if (emailSent) {
    log(`Weekly digest sent to ${merchant.email}`, 'worker');
  } else {
    throw new Error('Failed to send weekly digest email');
  }
  
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

export function startWorker(): void {
  log('Worker starting...', 'worker');

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
