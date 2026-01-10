import { 
  merchants, 
  scheduledTasks, 
  usageLogs, 
  processedEvents, 
  dailyMetrics,
  type Merchant, 
  type InsertMerchant,
  type ScheduledTask,
  type InsertScheduledTask,
  type UsageLog,
  type InsertUsageLog,
  type ProcessedEvent,
  type InsertProcessedEvent,
  type DailyMetric,
  type InsertDailyMetric,
  TaskStatus,
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, and, sql, desc, lte, asc } from "drizzle-orm";

export interface IStorage {
  // Merchants
  getMerchant(id: string): Promise<Merchant | undefined>;
  getMerchantByStripeConnectId(stripeConnectId: string): Promise<Merchant | undefined>;
  getMerchantByOAuthState(state: string): Promise<Merchant | undefined>;
  getMerchants(): Promise<Merchant[]>;
  createMerchant(merchant: InsertMerchant): Promise<Merchant>;
  updateMerchant(id: string, data: Partial<InsertMerchant>): Promise<Merchant | undefined>;

  // Tasks - with SELECT FOR UPDATE SKIP LOCKED for concurrency
  getTask(id: number): Promise<ScheduledTask | undefined>;
  getTasks(status?: string): Promise<ScheduledTask[]>;
  getRecentTasks(limit?: number): Promise<ScheduledTask[]>;
  createTask(task: InsertScheduledTask): Promise<ScheduledTask>;
  updateTaskStatus(id: number, status: string): Promise<ScheduledTask | undefined>;
  claimNextTask(): Promise<ScheduledTask | undefined>;
  deleteTask(id: number): Promise<boolean>;
  deleteCompletedTasks(): Promise<number>;

  // Usage Logs
  getUsageLogs(merchantId?: string, metricType?: string, limit?: number): Promise<UsageLog[]>;
  createUsageLog(log: InsertUsageLog): Promise<UsageLog>;
  getMonthlyDunningCount(merchantId: string): Promise<number>;

  // Processed Events - Idempotency
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<ProcessedEvent>;

  // Daily Metrics
  getDailyMetrics(merchantId: string, days?: number): Promise<DailyMetric[]>;
  updateDailyMetrics(merchantId: string, recoveredCents: number): Promise<DailyMetric>;

  // Dashboard Stats
  getDashboardStats(): Promise<{
    totalRecovered: number;
    activeMerchants: number;
    pendingTasks: number;
    runningTasks: number;
    successRate: number;
    processingRate: number;
    lastProcessedAt: string | null;
    trends: { recovered: number; merchants: number; tasks: number };
  }>;
}

export class DatabaseStorage implements IStorage {
  // Merchants
  async getMerchant(id: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, id));
    return merchant;
  }

  async getMerchantByStripeConnectId(stripeConnectId: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.stripeConnectId, stripeConnectId));
    return merchant;
  }

  async getMerchantByOAuthState(state: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.oauthState, state));
    return merchant;
  }

  async getMerchants(): Promise<Merchant[]> {
    return db.select().from(merchants).orderBy(desc(merchants.createdAt));
  }

  async createMerchant(merchant: InsertMerchant): Promise<Merchant> {
    const [created] = await db.insert(merchants).values(merchant).returning();
    return created;
  }

  async updateMerchant(id: string, data: Partial<InsertMerchant>): Promise<Merchant | undefined> {
    const [updated] = await db.update(merchants).set(data).where(eq(merchants.id, id)).returning();
    return updated;
  }

  // Tasks with SELECT FOR UPDATE SKIP LOCKED
  async getTask(id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id));
    return task;
  }

  async getTasks(status?: string): Promise<ScheduledTask[]> {
    if (status && status !== "all") {
      return db.select().from(scheduledTasks)
        .where(eq(scheduledTasks.status, status))
        .orderBy(desc(scheduledTasks.createdAt));
    }
    return db.select().from(scheduledTasks).orderBy(desc(scheduledTasks.createdAt));
  }

  async getRecentTasks(limit: number = 10): Promise<ScheduledTask[]> {
    return db.select().from(scheduledTasks)
      .orderBy(desc(scheduledTasks.createdAt))
      .limit(limit);
  }

  async createTask(task: InsertScheduledTask): Promise<ScheduledTask> {
    const [created] = await db.insert(scheduledTasks).values(task).returning();
    return created;
  }

  async updateTaskStatus(id: number, status: string): Promise<ScheduledTask | undefined> {
    const [updated] = await db.update(scheduledTasks)
      .set({ status })
      .where(eq(scheduledTasks.id, id))
      .returning();
    return updated;
  }

  // CRITICAL: SELECT FOR UPDATE SKIP LOCKED for concurrent task claiming
  async claimNextTask(): Promise<ScheduledTask | undefined> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // SELECT FOR UPDATE SKIP LOCKED prevents race conditions
      const result = await client.query(`
        SELECT * FROM scheduled_tasks 
        WHERE status = $1 AND run_at <= NOW()
        ORDER BY run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, [TaskStatus.PENDING]);

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return undefined;
      }

      const task = result.rows[0];
      
      // Update status to running within transaction
      await client.query(`
        UPDATE scheduled_tasks SET status = $1 WHERE id = $2
      `, [TaskStatus.RUNNING, task.id]);

      await client.query('COMMIT');

      return {
        id: task.id,
        merchantId: task.merchant_id,
        taskType: task.task_type,
        payload: task.payload,
        status: TaskStatus.RUNNING,
        runAt: task.run_at,
        createdAt: task.created_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteTask(id: number): Promise<boolean> {
    const result = await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).returning();
    return result.length > 0;
  }

  async deleteCompletedTasks(): Promise<number> {
    const result = await db.delete(scheduledTasks)
      .where(eq(scheduledTasks.status, TaskStatus.COMPLETED))
      .returning();
    return result.length;
  }

  // Usage Logs
  async getUsageLogs(merchantId?: string, metricType?: string, limit: number = 100): Promise<UsageLog[]> {
    let query = db.select().from(usageLogs);
    
    if (merchantId && metricType && metricType !== "all") {
      return db.select().from(usageLogs)
        .where(and(eq(usageLogs.merchantId, merchantId), eq(usageLogs.metricType, metricType)))
        .orderBy(desc(usageLogs.createdAt))
        .limit(limit);
    } else if (merchantId) {
      return db.select().from(usageLogs)
        .where(eq(usageLogs.merchantId, merchantId))
        .orderBy(desc(usageLogs.createdAt))
        .limit(limit);
    } else if (metricType && metricType !== "all") {
      return db.select().from(usageLogs)
        .where(eq(usageLogs.metricType, metricType))
        .orderBy(desc(usageLogs.createdAt))
        .limit(limit);
    }
    
    return db.select().from(usageLogs)
      .orderBy(desc(usageLogs.createdAt))
      .limit(limit);
  }

  async createUsageLog(log: InsertUsageLog): Promise<UsageLog> {
    const [created] = await db.insert(usageLogs).values(log).returning();
    return created;
  }

  async getMonthlyDunningCount(merchantId: string): Promise<number> {
    const [result] = await db.select({
      total: sql<number>`COALESCE(SUM(amount), 0)::int`
    })
    .from(usageLogs)
    .where(and(
      eq(usageLogs.merchantId, merchantId),
      eq(usageLogs.metricType, 'dunning_email_sent'),
      sql`created_at >= date_trunc('month', CURRENT_DATE)`
    ));
    
    return result?.total || 0;
  }

  // Processed Events - Idempotency
  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const [event] = await db.select().from(processedEvents).where(eq(processedEvents.eventId, eventId));
    return !!event;
  }

  async markEventProcessed(eventId: string): Promise<ProcessedEvent> {
    const [created] = await db.insert(processedEvents).values({ eventId }).returning();
    return created;
  }

  // Daily Metrics
  async getDailyMetrics(merchantId: string, days: number = 30): Promise<DailyMetric[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return db.select().from(dailyMetrics)
      .where(eq(dailyMetrics.merchantId, merchantId))
      .orderBy(desc(dailyMetrics.metricDate))
      .limit(days);
  }

  async updateDailyMetrics(merchantId: string, recoveredCents: number): Promise<DailyMetric> {
    const today = new Date().toISOString().split('T')[0];
    
    // Upsert pattern
    const [existing] = await db.select().from(dailyMetrics)
      .where(and(
        eq(dailyMetrics.merchantId, merchantId),
        eq(dailyMetrics.metricDate, today)
      ));

    if (existing) {
      const [updated] = await db.update(dailyMetrics)
        .set({ recoveredCents: (existing.recoveredCents || 0) + recoveredCents })
        .where(and(
          eq(dailyMetrics.merchantId, merchantId),
          eq(dailyMetrics.metricDate, today)
        ))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(dailyMetrics)
        .values({ merchantId, metricDate: today, recoveredCents })
        .returning();
      return created;
    }
  }

  // Dashboard Stats
  async getDashboardStats() {
    const [merchantCount] = await db.select({ count: sql<number>`count(*)::int` }).from(merchants);
    
    const [pendingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.status, TaskStatus.PENDING));
    
    const [runningCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.status, TaskStatus.RUNNING));

    const [totalRecovered] = await db.select({ 
      total: sql<number>`COALESCE(sum(recovered_cents), 0)::int` 
    }).from(dailyMetrics);

    // Get success rate from last 7 days
    const [successStats] = await db.select({
      success: sql<number>`count(*) filter (where metric_type = 'recovery_success')::int`,
      failed: sql<number>`count(*) filter (where metric_type = 'recovery_failed')::int`,
    }).from(usageLogs)
      .where(sql`created_at > NOW() - INTERVAL '7 days'`);

    const totalAttempts = (successStats?.success || 0) + (successStats?.failed || 0);
    const successRate = totalAttempts > 0 
      ? Math.round((successStats.success / totalAttempts) * 100) 
      : 100;

    // Processing rate (tasks per minute in last hour)
    const [rateStats] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(usageLogs)
      .where(sql`created_at > NOW() - INTERVAL '1 hour'`);

    const processingRate = Math.round((rateStats?.count || 0) / 60);

    // Last processed
    const [lastLog] = await db.select()
      .from(usageLogs)
      .orderBy(desc(usageLogs.createdAt))
      .limit(1);

    return {
      totalRecovered: totalRecovered?.total || 0,
      activeMerchants: merchantCount?.count || 0,
      pendingTasks: pendingCount?.count || 0,
      runningTasks: runningCount?.count || 0,
      successRate,
      processingRate,
      lastProcessedAt: lastLog?.createdAt?.toISOString() || null,
      trends: {
        recovered: 12, // Placeholder for trend calculation
        merchants: 5,
        tasks: -3,
      },
    };
  }
}

export const storage = new DatabaseStorage();
