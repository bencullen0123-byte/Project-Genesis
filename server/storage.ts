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
import { encrypt, decrypt } from "./lib/encryption";

function decryptMerchant(merchant: Merchant): Merchant {
  return {
    ...merchant,
    accessToken: merchant.accessToken ? decrypt(merchant.accessToken) : merchant.accessToken,
    refreshToken: merchant.refreshToken ? decrypt(merchant.refreshToken) : merchant.refreshToken,
  };
}

function encryptMerchantData(data: Partial<InsertMerchant>): Partial<InsertMerchant> {
  const encrypted = { ...data };
  if (encrypted.accessToken) {
    encrypted.accessToken = encrypt(encrypted.accessToken);
  }
  if (encrypted.refreshToken) {
    encrypted.refreshToken = encrypt(encrypted.refreshToken);
  }
  return encrypted;
}

export interface IStorage {
  // Merchants
  getMerchant(id: string): Promise<Merchant | undefined>;
  getMerchantByStripeConnectId(stripeConnectId: string): Promise<Merchant | undefined>;
  getMerchantByOAuthState(state: string): Promise<Merchant | undefined>;
  getMerchantByClerkUserId(clerkUserId: string): Promise<Merchant | undefined>;
  getMerchants(): Promise<Merchant[]>;
  createMerchant(merchant: InsertMerchant): Promise<Merchant>;
  updateMerchant(id: string, data: Partial<InsertMerchant>): Promise<Merchant | undefined>;
  deleteMerchant(id: string): Promise<boolean>;

  // Tasks - with SELECT FOR UPDATE SKIP LOCKED for concurrency
  getTask(id: number): Promise<ScheduledTask | undefined>;
  getTasks(merchantId: string, status?: string): Promise<ScheduledTask[]>;
  getRecentTasks(merchantId: string, limit?: number): Promise<ScheduledTask[]>;
  createTask(task: InsertScheduledTask): Promise<ScheduledTask>;
  updateTaskStatus(id: number, status: string): Promise<ScheduledTask | undefined>;
  claimNextTask(): Promise<ScheduledTask | undefined>;
  deleteTask(id: number): Promise<boolean>;
  deleteCompletedTasks(merchantId: string): Promise<number>;
  deletePendingTasks(merchantId: string): Promise<number>;
  deleteAllTasksForMerchant(merchantId: string): Promise<number>;

  // Usage Logs
  getUsageLogs(merchantId?: string, metricType?: string, limit?: number): Promise<UsageLog[]>;
  createUsageLog(log: InsertUsageLog): Promise<UsageLog>;
  getMonthlyDunningCount(merchantId: string): Promise<number>;
  getPendingUsageLogs(limit: number): Promise<UsageLog[]>;
  markUsageAsReported(ids: number[]): Promise<void>;
  deleteUsageLogs(merchantId: string): Promise<number>;
  
  // Reporter Tasks
  hasReportUsageTask(): Promise<boolean>;

  // Processed Events - Idempotency
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<ProcessedEvent>;
  attemptEventLock(eventId: string): Promise<boolean>;

  // Daily Metrics
  getDailyMetrics(merchantId: string, days?: number): Promise<DailyMetric[]>;
  updateDailyMetrics(merchantId: string, recoveredCents: number, emailsSent?: number): Promise<DailyMetric>;
  deleteDailyMetrics(merchantId: string): Promise<number>;
  getDashboardMetrics(merchantId: string): Promise<{
    totalRecoveredCents: number;
    totalEmailsSent: number;
    daysTracked: number;
  }>;
  getWeeklyMetrics(merchantId: string): Promise<{
    totalRecoveredCents: number;
    totalEmailsSent: number;
  }>;
  
  // Weekly Digest Tasks
  hasWeeklyDigestTask(merchantId: string): Promise<boolean>;

  // Dashboard Stats
  getDashboardStats(merchantId: string): Promise<{
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
  // Merchants (with field-level encryption for tokens)
  async getMerchant(id: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, id));
    return merchant ? decryptMerchant(merchant) : undefined;
  }

  async getMerchantByStripeConnectId(stripeConnectId: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.stripeConnectId, stripeConnectId));
    return merchant ? decryptMerchant(merchant) : undefined;
  }

  async getMerchantByOAuthState(state: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.oauthState, state));
    return merchant ? decryptMerchant(merchant) : undefined;
  }

  async getMerchantByClerkUserId(clerkUserId: string): Promise<Merchant | undefined> {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.clerkUserId, clerkUserId));
    return merchant ? decryptMerchant(merchant) : undefined;
  }

  async getMerchants(): Promise<Merchant[]> {
    const result = await db.select().from(merchants).orderBy(desc(merchants.createdAt));
    return result.map(decryptMerchant);
  }

  async createMerchant(merchant: InsertMerchant): Promise<Merchant> {
    const encryptedData = encryptMerchantData(merchant);
    const [created] = await db.insert(merchants).values(encryptedData).returning();
    return decryptMerchant(created);
  }

  async updateMerchant(id: string, data: Partial<InsertMerchant>): Promise<Merchant | undefined> {
    const encryptedData = encryptMerchantData(data);
    const [updated] = await db.update(merchants).set(encryptedData).where(eq(merchants.id, id)).returning();
    return updated ? decryptMerchant(updated) : undefined;
  }

  async deleteMerchant(id: string): Promise<boolean> {
    const result = await db.delete(merchants).where(eq(merchants.id, id)).returning();
    return result.length > 0;
  }

  // Tasks with SELECT FOR UPDATE SKIP LOCKED
  async getTask(id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id));
    return task;
  }

  async getTasks(merchantId: string, status?: string): Promise<ScheduledTask[]> {
    if (status && status !== "all") {
      return db.select().from(scheduledTasks)
        .where(and(
          eq(scheduledTasks.merchantId, merchantId),
          eq(scheduledTasks.status, status)
        ))
        .orderBy(desc(scheduledTasks.createdAt));
    }
    return db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.merchantId, merchantId))
      .orderBy(desc(scheduledTasks.createdAt));
  }

  async getRecentTasks(merchantId: string, limit: number = 10): Promise<ScheduledTask[]> {
    return db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.merchantId, merchantId))
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

  async deleteCompletedTasks(merchantId: string): Promise<number> {
    const result = await db.delete(scheduledTasks)
      .where(and(
        eq(scheduledTasks.status, TaskStatus.COMPLETED),
        eq(scheduledTasks.merchantId, merchantId)
      ))
      .returning();
    return result.length;
  }

  async deletePendingTasks(merchantId: string): Promise<number> {
    const result = await db.delete(scheduledTasks)
      .where(and(
        eq(scheduledTasks.merchantId, merchantId),
        sql`status IN ('pending', 'running')`
      ))
      .returning();
    return result.length;
  }

  async deleteAllTasksForMerchant(merchantId: string): Promise<number> {
    const result = await db.delete(scheduledTasks)
      .where(eq(scheduledTasks.merchantId, merchantId))
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const insertResult = await client.query(`
        INSERT INTO usage_logs (merchant_id, metric_type, amount)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [log.merchantId, log.metricType, log.amount || 1]);
      
      const created = insertResult.rows[0];
      
      const emailsSent = log.metricType === 'dunning_email_sent' ? (log.amount || 1) : 0;
      
      await client.query(`
        INSERT INTO daily_metrics (merchant_id, metric_date, recovered_cents, emails_sent)
        VALUES ($1, CURRENT_DATE, $2, $3)
        ON CONFLICT (merchant_id, metric_date)
        DO UPDATE SET
          recovered_cents = daily_metrics.recovered_cents + EXCLUDED.recovered_cents,
          emails_sent = daily_metrics.emails_sent + EXCLUDED.emails_sent
      `, [log.merchantId, 0, emailsSent]);
      
      await client.query('COMMIT');
      
      return {
        id: created.id,
        merchantId: created.merchant_id,
        metricType: created.metric_type,
        amount: created.amount,
        createdAt: created.created_at,
        reportedAt: created.reported_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  async getPendingUsageLogs(limit: number): Promise<UsageLog[]> {
    return db.select().from(usageLogs)
      .where(sql`reported_at IS NULL`)
      .orderBy(asc(usageLogs.createdAt))
      .limit(limit);
  }

  async markUsageAsReported(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db.update(usageLogs)
      .set({ reportedAt: sql`NOW()` })
      .where(sql`id = ANY(ARRAY[${sql.raw(ids.join(','))}]::int[])`);
  }

  async deleteUsageLogs(merchantId: string): Promise<number> {
    const result = await db.delete(usageLogs)
      .where(eq(usageLogs.merchantId, merchantId))
      .returning();
    return result.length;
  }

  async hasReportUsageTask(): Promise<boolean> {
    const [task] = await db.select().from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.taskType, 'report_usage'),
        sql`status IN ('pending', 'running')`
      ))
      .limit(1);
    return !!task;
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

  async attemptEventLock(eventId: string): Promise<boolean> {
    const [locked] = await db.insert(processedEvents)
      .values({ eventId })
      .onConflictDoNothing()
      .returning();
    return !!locked;
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

  async updateDailyMetrics(merchantId: string, recoveredCents: number, emailsSent: number = 0): Promise<DailyMetric> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO daily_metrics (merchant_id, metric_date, recovered_cents, emails_sent)
        VALUES ($1, CURRENT_DATE, $2, $3)
        ON CONFLICT (merchant_id, metric_date)
        DO UPDATE SET
          recovered_cents = daily_metrics.recovered_cents + EXCLUDED.recovered_cents,
          emails_sent = daily_metrics.emails_sent + EXCLUDED.emails_sent
        RETURNING *
      `, [merchantId, recoveredCents, emailsSent]);
      
      const row = result.rows[0];
      return {
        merchantId: row.merchant_id,
        metricDate: row.metric_date,
        recoveredCents: Number(row.recovered_cents),
        emailsSent: row.emails_sent,
      };
    } finally {
      client.release();
    }
  }

  async getDashboardMetrics(merchantId: string): Promise<{
    totalRecoveredCents: number;
    totalEmailsSent: number;
    daysTracked: number;
  }> {
    const [result] = await db.select({
      totalRecoveredCents: sql<number>`COALESCE(SUM(recovered_cents), 0)::bigint`,
      totalEmailsSent: sql<number>`COALESCE(SUM(emails_sent), 0)::int`,
      daysTracked: sql<number>`COUNT(*)::int`,
    })
    .from(dailyMetrics)
    .where(and(
      eq(dailyMetrics.merchantId, merchantId),
      sql`metric_date >= CURRENT_DATE - INTERVAL '30 days'`
    ));
    
    return {
      totalRecoveredCents: Number(result?.totalRecoveredCents || 0),
      totalEmailsSent: result?.totalEmailsSent || 0,
      daysTracked: result?.daysTracked || 0,
    };
  }

  async getWeeklyMetrics(merchantId: string): Promise<{
    totalRecoveredCents: number;
    totalEmailsSent: number;
  }> {
    const [result] = await db.select({
      totalRecoveredCents: sql<number>`COALESCE(SUM(recovered_cents), 0)::bigint`,
      totalEmailsSent: sql<number>`COALESCE(SUM(emails_sent), 0)::int`,
    })
    .from(dailyMetrics)
    .where(and(
      eq(dailyMetrics.merchantId, merchantId),
      sql`metric_date >= CURRENT_DATE - INTERVAL '7 days'`
    ));
    
    return {
      totalRecoveredCents: Number(result?.totalRecoveredCents || 0),
      totalEmailsSent: result?.totalEmailsSent || 0,
    };
  }

  async deleteDailyMetrics(merchantId: string): Promise<number> {
    const result = await db.delete(dailyMetrics)
      .where(eq(dailyMetrics.merchantId, merchantId))
      .returning();
    return result.length;
  }

  async hasWeeklyDigestTask(merchantId: string): Promise<boolean> {
    const [existing] = await db.select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.merchantId, merchantId),
        eq(scheduledTasks.taskType, 'send_weekly_digest'),
        sql`status IN ('pending', 'running')`
      ))
      .limit(1);
    return !!existing;
  }

  // Dashboard Stats (Tenant-Scoped)
  async getDashboardStats(merchantId: string) {
    const [pendingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.status, TaskStatus.PENDING),
        eq(scheduledTasks.merchantId, merchantId)
      ));
    
    const [runningCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.status, TaskStatus.RUNNING),
        eq(scheduledTasks.merchantId, merchantId)
      ));

    const [totalRecovered] = await db.select({ 
      total: sql<number>`COALESCE(sum(recovered_cents), 0)::int` 
    }).from(dailyMetrics)
      .where(eq(dailyMetrics.merchantId, merchantId));

    // Get success rate from last 7 days (scoped to merchant)
    const [successStats] = await db.select({
      success: sql<number>`count(*) filter (where metric_type = 'recovery_success')::int`,
      failed: sql<number>`count(*) filter (where metric_type = 'recovery_failed')::int`,
    }).from(usageLogs)
      .where(and(
        eq(usageLogs.merchantId, merchantId),
        sql`created_at > NOW() - INTERVAL '7 days'`
      ));

    const totalAttempts = (successStats?.success || 0) + (successStats?.failed || 0);
    const successRate = totalAttempts > 0 
      ? Math.round((successStats.success / totalAttempts) * 100) 
      : 100;

    // Processing rate (tasks per minute in last hour, scoped to merchant)
    const [rateStats] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(usageLogs)
      .where(and(
        eq(usageLogs.merchantId, merchantId),
        sql`created_at > NOW() - INTERVAL '1 hour'`
      ));

    const processingRate = Math.round((rateStats?.count || 0) / 60);

    // Last processed (scoped to merchant)
    const [lastLog] = await db.select()
      .from(usageLogs)
      .where(eq(usageLogs.merchantId, merchantId))
      .orderBy(desc(usageLogs.createdAt))
      .limit(1);

    return {
      totalRecovered: totalRecovered?.total || 0,
      activeMerchants: 1, // You are the only merchant in your view
      pendingTasks: pendingCount?.count || 0,
      runningTasks: runningCount?.count || 0,
      successRate,
      processingRate,
      lastProcessedAt: lastLog?.createdAt?.toISOString() || null,
      trends: {
        recovered: 12, // Placeholder for trend calculation
        merchants: 0,
        tasks: -3,
      },
    };
  }
}

export const storage = new DatabaseStorage();
