# The Citadel - Multi-Tenant Stripe Recovery Engine

## Overview
A headless, multi-tenant payment recovery engine built with strict architectural constraints for transactional integrity and concurrency control.

## Architecture

### Core Principles
- **Transactional Integrity**: All business logic is driven by database state - no in-memory queues or setTimeout
- **Concurrency Control**: Task queue uses `SELECT FOR UPDATE SKIP LOCKED` to prevent race conditions
- **Isolation**: PostgreSQL acts as the state machine for all operations
- **Idempotency**: Event deduplication via `processed_events` table

### Database Schema
1. **merchants** - Multi-tenant support with Stripe Connect credentials
2. **scheduled_tasks** - Task queue with status tracking (pending/running/completed/failed)
3. **usage_logs** - Activity ledger for UI and analytics
4. **processed_events** - Idempotency key storage
5. **daily_metrics** - Aggregated recovery metrics per merchant

### Autovacuum Optimization
High-churn tables have optimized autovacuum settings:
- `scheduled_tasks`: 5% vacuum scale factor
- `processed_events`: 5% vacuum scale factor  
- `usage_logs`: 10% vacuum scale factor

## Technology Stack

### Backend
- Node.js with Express
- PostgreSQL with Drizzle ORM
- Stripe SDK with stripe-replit-sync
- TypeScript

### Frontend
- React with Vite
- TanStack Query for data fetching
- Tailwind CSS with shadcn/ui components
- wouter for routing

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

## Development Commands

- `npm run dev` - Start development server
- `npm run db:push` - Push schema changes to database
- `npm run build` - Build for production

## Recent Changes
- 2026-01-09: Initial implementation of The Citadel MVP
  - Complete database schema with 5 tables
  - Frontend dashboard with metrics, task queue, merchants, activity pages
  - Backend APIs with SELECT FOR UPDATE SKIP LOCKED pattern
  - Stripe integration with webhook support
  - Autovacuum optimization applied
