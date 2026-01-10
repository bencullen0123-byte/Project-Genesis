# The Citadel - Multi-Tenant Stripe Recovery Engine

## Overview
A headless, multi-tenant payment recovery engine built with strict architectural constraints for transactional integrity and concurrency control.

## Architecture

### Core Principles
- **Transactional Integrity**: All business logic is driven by database state - no in-memory queues or setTimeout
- **Concurrency Control**: Task queue uses `SELECT FOR UPDATE SKIP LOCKED` to prevent race conditions
- **Isolation**: PostgreSQL acts as the state machine for all operations
- **Idempotency**: Event deduplication via `processed_events` table
- **Multi-Tenancy**: StripeClientFactory provides tenant-scoped Stripe clients with `stripeAccount` config

### Multi-Tenant Stripe Client Architecture

The `StripeClientFactory` class in `server/stripeClient.ts` provides proper multi-tenant isolation:

```typescript
// Get tenant-scoped Stripe client
const factory = await getStripeClientFactory();
const tenantClient = await factory.getClient(merchantId);

// Client is configured with { stripeAccount: merchant.stripeConnectId }
// All API calls through this client are scoped to the connected account
```

### Webhook Routing Logic

The `server/webhookHandlers.ts` implements granular control over payment failures:

**invoice.payment_failed handling:**
1. `billing_reason === 'subscription_create'` → IGNORE (Onboarding failure)
2. `billing_reason === 'subscription_cycle'` → PROCESS (Churn recovery - enqueue Dunning Task)
3. `billing_reason === 'subscription_update'` → IGNORE (Manual intervention)
4. `billing_reason === 'manual'` → IGNORE (Not automated recovery target)

### Stripe Connect OAuth Flow

The OAuth flow uses secure state tokens for CSRF protection:

1. **Authorize**: `POST /api/stripe/connect/authorize`
   - Generates cryptographically secure state token
   - Creates pending merchant record with state
   - Returns Stripe OAuth URL for redirect

2. **Callback**: `GET /api/stripe/connect/callback`
   - Validates state token against database
   - Exchanges authorization code for access token
   - Updates merchant with Stripe Connect credentials
   - Redirects to dashboard

### Database Schema
1. **merchants** - Multi-tenant support with Stripe Connect credentials, OAuth state
2. **scheduled_tasks** - Task queue with status tracking (pending/running/completed/failed)
3. **usage_logs** - Activity ledger for UI and analytics
4. **processed_events** - Idempotency key storage
5. **daily_metrics** - Aggregated recovery metrics per merchant

### Database Performance Tuning

Autovacuum settings applied on every server startup (persisted):
- `scheduled_tasks`: 1% vacuum scale factor (aggressive)
- `processed_events`: 1% vacuum scale factor (aggressive)
- `usage_logs`: 5% vacuum scale factor

## Technology Stack

### Backend
- Node.js with Express
- PostgreSQL with Drizzle ORM
- Stripe SDK (direct, no stripe-replit-sync)
- TypeScript

### Frontend
- Minimal React placeholder (headless API focus)

## API Endpoints

### Dashboard
- `GET /api/dashboard` - Overview stats, recent tasks, activity

### Tasks
- `GET /api/tasks` - List all tasks (with optional status filter)
- `GET /api/tasks/:id` - Get single task
- `POST /api/tasks` - Create new task
- `POST /api/tasks/:id/retry` - Retry failed task
- `DELETE /api/tasks/:id` - Delete task
- `DELETE /api/tasks/completed` - Clear completed tasks

### Merchants
- `GET /api/merchants` - List all merchants
- `GET /api/merchants/:id` - Get single merchant
- `POST /api/merchants` - Create merchant

### Activity
- `GET /api/activity` - List usage logs

### Worker
- `POST /api/worker/claim` - Claim next pending task (uses SKIP LOCKED)
- `POST /api/worker/complete/:id` - Mark task complete/failed

### Stripe Connect OAuth
- `POST /api/stripe/connect/authorize` - Initiate OAuth flow (requires STRIPE_CLIENT_ID env var)
- `GET /api/stripe/connect/callback` - Handle OAuth callback from Stripe

### Stripe Webhook
- `POST /api/stripe/webhook` - Handles Stripe webhook events with billing_reason filtering

### Health
- `GET /api/health` - System health check

## Task Queue Pattern

The worker uses PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent task processing:

```sql
SELECT * FROM scheduled_tasks 
WHERE status = 'pending' AND run_at <= NOW()
ORDER BY run_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

This ensures:
- No two workers can claim the same task
- Locked rows are skipped, not blocked
- Full ACID compliance

## Environment Variables

Required for full functionality:
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `STRIPE_CLIENT_ID` - Your Stripe Connect platform client ID (for OAuth)

## Key Files

- `server/stripeClient.ts` - StripeClientFactory for multi-tenant Stripe clients
- `server/webhookHandlers.ts` - Manual webhook routing with billing_reason filtering
- `server/routes.ts` - API routes including OAuth endpoints
- `server/storage.ts` - Database operations with SELECT FOR UPDATE SKIP LOCKED
- `shared/schema.ts` - Drizzle ORM schema definitions

## Development Commands

- `npm run dev` - Start development server
- `npm run db:push` - Push schema changes to database
- `npm run build` - Build for production

## Sprint 1 Status: COMPLETE

### Completed Stories:
- Story 1: Database schema with optimized autovacuum (persisted on startup)
- Story 2: StripeClientFactory for multi-tenant isolation
- Story 3: Stripe Connect OAuth flow (authorize + callback endpoints)
- Story 4: Webhook handlers with billing_reason filtering

## Sprint 2 Status: COMPLETE

### Completed Stories:
- Story 5: Worker hot loop with recursive setTimeout, dunning processor, Shadow Ledger with getMonthlyDunningCount, Bouncer middleware (1000/month limit), wired to /api/tasks with live usage in dashboard

## Sprint 3 Status: COMPLETE

### Completed Stories:
- Story 6: Webhook Engine with raw body parsing, STRIPE_WEBHOOK_SECRET verification, invoice.payment_failed and invoice.payment_action_required handling
- Story 7: Metered Reporting with reportedAt column, getPendingUsageLogs/markUsageAsReported storage methods, report_usage task processor with self-scheduling, bootstrap on startup

### Task Types Supported:
- `dunning_retry` - Process failed subscription payments
- `notify_action_required` - Notify customers about required payment actions
- `report_usage` - Sync usage data to Stripe meter events (self-scheduling every 5 min)

## Recent Changes
- 2026-01-10: Sprint 3 Complete
  - Added STRIPE_WEBHOOK_SECRET environment variable support for signature verification
  - Added invoice.payment_action_required webhook handling
  - Added reportedAt column to usage_logs for tracking reported usage
  - Implemented report_usage task with Stripe billing.meterEvents integration
  - Added bootstrap logic to ensure report_usage task always exists
  - Self-scheduling reporter runs every 5 minutes

- 2026-01-09: Sprint 1 & 2 Complete
  - Implemented StripeClientFactory for proper multi-tenant isolation
  - Created webhookHandlers.ts with billing_reason filtering
  - Implemented full Stripe Connect OAuth flow
  - Added database warmup with autovacuum settings on startup
  - Worker hot loop with SKIP LOCKED concurrency
  - Bouncer middleware enforcing 1000/month usage limit
  - Dashboard with live usage data
