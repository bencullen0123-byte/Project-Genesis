import { pool } from './db';
import { log } from './index';

const ZOMBIE_THRESHOLD_MINUTES = 10;
const EVENT_RETENTION_DAYS = 7;

export async function runCleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    const rescuedResult = await client.query(`
      UPDATE scheduled_tasks
      SET status = 'pending', run_at = NOW()
      WHERE status = 'running'
        AND created_at < NOW() - INTERVAL '${ZOMBIE_THRESHOLD_MINUTES} minutes'
      RETURNING id
    `);
    
    const rescuedCount = rescuedResult.rowCount || 0;
    if (rescuedCount > 0) {
      log(`Rescued ${rescuedCount} stuck tasks`, 'cron');
    }

    const prunedResult = await client.query(`
      DELETE FROM processed_events
      WHERE processed_at < NOW() - INTERVAL '${EVENT_RETENTION_DAYS} days'
      RETURNING event_id
    `);
    
    const prunedCount = prunedResult.rowCount || 0;
    if (prunedCount > 0) {
      log(`Pruned ${prunedCount} old webhook events`, 'cron');
    }

    if (rescuedCount === 0 && prunedCount === 0) {
      log('Cleanup complete - nothing to do', 'cron');
    }
  } catch (error: any) {
    log(`Cleanup error: ${error.message}`, 'cron');
  } finally {
    client.release();
  }
}
