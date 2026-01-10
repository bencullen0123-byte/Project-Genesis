import { storage } from './storage';
import { log } from './index';
import { getStripeClientFactory } from './stripeClient';
import type { ScheduledTask } from '@shared/schema';

const POLL_INTERVAL_MS = 1000;
const ERROR_BACKOFF_MS = 5000;
const TASK_FOUND_DELAY_MS = 100;

async function processTask(task: ScheduledTask): Promise<void> {
  switch (task.taskType) {
    case 'dunning_retry': {
      const factory = await getStripeClientFactory();
      const stripe = await factory.getClient(task.merchantId);
      
      const payload = task.payload as { invoiceId: string };
      
      const invoice = await stripe.invoices.retrieve(payload.invoiceId);
      
      if (invoice.status === 'paid' || invoice.status === 'void') {
        log(`Invoice ${payload.invoiceId} already resolved (status: ${invoice.status})`, 'worker');
        return;
      }
      
      if (invoice.status === 'open') {
        const customerEmail = typeof invoice.customer_email === 'string' 
          ? invoice.customer_email 
          : 'unknown';
        
        log(`Simulation: Sending dunning email to ${customerEmail}`, 'worker');
        
        await storage.createUsageLog({
          merchantId: task.merchantId,
          metricType: 'dunning_email_sent',
          amount: 1,
        });
        
        log(`Usage log created for merchant ${task.merchantId}`, 'worker');
      }
      break;
    }
    
    default:
      log(`Unknown task type: ${task.taskType}`, 'worker');
  }
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
        } catch (taskError: any) {
          log(`Task ${task.id} processing error: ${taskError.message}`, 'worker');
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
