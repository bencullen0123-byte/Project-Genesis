import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial, integer, jsonb, bigint, date, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// 1. MERCHANTS TABLE - Multi-tenant support
export const merchants = pgTable("merchants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email"),
  clerkUserId: text("clerk_user_id").unique(),
  stripeConnectId: text("stripe_connect_id").unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeUserId: text("stripe_user_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  oauthState: text("oauth_state"),
  tier: text("tier").default("FREE").notNull(),
  subscriptionPlanId: text("subscription_plan_id"),
  billingCountry: text("billing_country"),
  billingAddress: text("billing_address"),
  brandColor: text("brand_color").default("#000000").notNull(),
  logoUrl: text("logo_url"),
  fromName: text("from_name"),
  supportEmail: text("support_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_merchants_stripe_connect").on(table.stripeConnectId),
  index("idx_merchants_stripe_customer").on(table.stripeCustomerId),
  index("idx_merchants_oauth_state").on(table.oauthState),
  index("idx_merchants_clerk_user").on(table.clerkUserId),
]);

// 2. SCHEDULED TASKS - The Queue (State Machine)
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").default("pending").notNull(),
  runAt: timestamp("run_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tasks_status_run_at").on(table.status, table.runAt),
  index("idx_tasks_merchant").on(table.merchantId),
]);

// 3. USAGE LOGS - The Ledger (Shadow Copy for UI)
export const usageLogs = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  metricType: text("metric_type").notNull(),
  amount: integer("amount").default(1).notNull(),
  
  // TRACKING TIMESTAMPS (Ticket 23.1 - Funnel Analytics)
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reportedAt: timestamp("reported_at"),
}, (table) => [
  index("idx_usage_merchant_metric").on(table.merchantId, table.metricType),
  index("idx_usage_reported").on(table.reportedAt),
]);

// 4. PROCESSED EVENTS - Event Historian (Idempotency)
export const processedEvents = pgTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// 5. DAILY METRICS - Analytics (Materialized View substitute)
export const dailyMetrics = pgTable("daily_metrics", {
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  metricDate: date("metric_date").defaultNow().notNull(),
  recoveredCents: bigint("recovered_cents", { mode: "number" }).default(0).notNull(),
  emailsSent: integer("emails_sent").default(0).notNull(),
  
  // ANALYTICS COUNTERS (Ticket 23.1 - Funnel Analytics)
  totalOpens: integer("total_opens").default(0).notNull(),
  totalClicks: integer("total_clicks").default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.merchantId, table.metricDate] }),
]);

// 6. EMAIL TEMPLATES - Custom dunning sequences per merchant
export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  retryAttempt: integer("retry_attempt").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_templates_merchant_retry").on(table.merchantId, table.retryAttempt),
]);

// Relations
export const merchantsRelations = relations(merchants, ({ many }) => ({
  scheduledTasks: many(scheduledTasks),
  usageLogs: many(usageLogs),
  dailyMetrics: many(dailyMetrics),
  emailTemplates: many(emailTemplates),
}));

export const scheduledTasksRelations = relations(scheduledTasks, ({ one }) => ({
  merchant: one(merchants, {
    fields: [scheduledTasks.merchantId],
    references: [merchants.id],
  }),
}));

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
  merchant: one(merchants, {
    fields: [usageLogs.merchantId],
    references: [merchants.id],
  }),
}));

export const dailyMetricsRelations = relations(dailyMetrics, ({ one }) => ({
  merchant: one(merchants, {
    fields: [dailyMetrics.merchantId],
    references: [merchants.id],
  }),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  merchant: one(merchants, {
    fields: [emailTemplates.merchantId],
    references: [merchants.id],
  }),
}));

// Insert schemas
export const insertMerchantSchema = createInsertSchema(merchants).omit({
  id: true,
  createdAt: true,
});

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({
  id: true,
  createdAt: true,
});

export const insertUsageLogSchema = createInsertSchema(usageLogs).omit({
  id: true,
  createdAt: true,
});

export const insertProcessedEventSchema = createInsertSchema(processedEvents).omit({
  processedAt: true,
});

export const insertDailyMetricSchema = createInsertSchema(dailyMetrics);

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true,
  createdAt: true,
});

// Types
export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = z.infer<typeof insertMerchantSchema>;

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = z.infer<typeof insertScheduledTaskSchema>;

export type UsageLog = typeof usageLogs.$inferSelect;
export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type InsertProcessedEvent = z.infer<typeof insertProcessedEventSchema>;

export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type InsertDailyMetric = z.infer<typeof insertDailyMetricSchema>;

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;

// Task status enum for type safety
export const TaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

// Tier enum
export const MerchantTier = {
  FREE: "FREE",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;

export type MerchantTierType = typeof MerchantTier[keyof typeof MerchantTier];
