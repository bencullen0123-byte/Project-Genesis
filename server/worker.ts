import { storage } from './storage';
import { log } from './index';

const POLL_INTERVAL_MS = 1000;
const ERROR_BACKOFF_MS = 5000;
const TASK_FOUND_DELAY_MS = 100;

export function startWorker(): void {
  log('Worker starting...', 'worker');

  async function run(): Promise<void> {
    try {
      const task = await storage.claimNextTask();

      if (task) {
        log(`Claimed task ${task.id} type ${task.taskType}`, 'worker');
        
        // TODO: Phase 2 - Process the task based on taskType
        // For now, just claim and immediately look for more tasks
        
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
