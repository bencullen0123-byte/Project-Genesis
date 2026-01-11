# The Citadel - Multi-Tenant Stripe Recovery Engine

## Overview
The Citadel is a headless, multi-tenant payment recovery engine designed to maximize revenue retention for businesses using Stripe. It automates the process of recovering failed payments and managing subscription churn through a robust, fault-tolerant system. The project aims to provide a critical service for businesses seeking to minimize involuntary churn and improve their financial health by ensuring transactional integrity and efficient dunning management.

## User Preferences
I want iterative development and detailed explanations. Ask before making major changes.

## System Architecture

### Core Principles
-   **Transactional Integrity**: All business logic is driven by database state.
-   **Concurrency Control**: Task queue uses `SELECT FOR UPDATE SKIP LOCKED` to prevent race conditions.
-   **Isolation**: PostgreSQL acts as the state machine for all operations.
-   **Idempotency**: Event deduplication via `processed_events` table.
-   **Multi-Tenancy**: `StripeClientFactory` provides tenant-scoped Stripe clients with `stripeAccount` configuration.

### Multi-Tenant Stripe Client Architecture
The `StripeClientFactory` ensures proper multi-tenant isolation by configuring Stripe API calls to be scoped to specific connected accounts using `stripeAccount: merchant.stripeConnectId`.

### Webhook Routing Logic
`server/webhookHandlers.ts` provides granular control over payment failures, processing `invoice.payment_failed` events only for `subscription_cycle` billing reasons (churn recovery), and ignoring others (onboarding, manual intervention, updates). `invoice.payment_action_required` webhooks are also handled.

### Stripe Connect OAuth Flow
The OAuth flow uses secure state tokens for CSRF protection, enabling merchants to connect their Stripe accounts securely.

### Database Schema
Key tables include `merchants` (Stripe Connect credentials, OAuth state), `scheduled_tasks` (task queue with status tracking), `usage_logs` (activity ledger), `processed_events` (idempotency key storage), and `daily_metrics` (aggregated recovery metrics).

### Database Performance Tuning
Aggressive autovacuum settings are applied to `scheduled_tasks` and `processed_events` tables (1% vacuum scale factor) and `usage_logs` (5% vacuum scale factor) to maintain performance.

### Technology Stack
-   **Backend**: Node.js with Express, PostgreSQL with Drizzle ORM, TypeScript.
-   **Frontend**: Minimal React placeholder (focus on headless API).

### API Endpoints
Provides endpoints for dashboard statistics, task management (list, get, create, retry, delete), merchant management, activity logs, worker task claiming and completion, Stripe Connect OAuth, Stripe webhooks, and health checks.

### Task Queue Pattern
Utilizes PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED` to ensure safe, concurrent task processing by workers, guaranteeing no two workers claim the same task and providing ACID compliance.

### Real-Time Analytics Architecture
The analytics system uses application-side triggers for O(1) dashboard queries. `createUsageLog()` atomically updates `daily_metrics` using PostgreSQL `ON CONFLICT DO UPDATE` for race-free aggregation. `getDashboardMetrics()` queries pre-aggregated data for efficiency.

### Self-Healing Janitor
A cron job (`server/cron.ts`) automatically rescues tasks stuck in 'running' status and prunes old `processed_events` to maintain system health and prevent unbounded growth.

### Email Engine
Integrates with Resend for transactional emails, including dunning and action-required notifications. Features dev-mode safety (console logging if no API key) and includes `X-Entity-Ref-ID` for tracking.

### Weekly Digest System
Sends weekly "proof of value" emails to merchants, aggregating recovery metrics from `daily_metrics` and self-scheduling future digests.

### Security & Reliability
-   **Encryption**: `accessToken` and `refreshToken` are encrypted at rest using AES-256-GCM.
-   **Idempotency**: `idempotencyKey` is used for all Stripe mutations.
-   **Graceful Shutdown**: SIGTERM/SIGINT handlers ensure clean server termination.
-   **Database Indexes**: Applied to `scheduled_tasks` and `merchants` for performance.
-   **IDOR Fix**: PATCH requests to `/api/merchants/:id` require `X-Merchant-Stripe-Id` header for authorization.
-   **Authentication**: Clerk Authentication for user management and auto-provisioning of new users as FREE tier merchants.

### Task Types Supported
-   `dunning_retry`: Process failed subscription payments.
-   `notify_action_required`: Notify customers about required payment actions (e.g., 3DS/SCA).
-   `report_usage`: Sync usage data to Stripe meter events.
-   `send_weekly_digest`: Send weekly "proof of value" emails to merchants.

## External Dependencies

-   **Stripe**: Payment processing, Stripe Connect for multi-tenancy, webhooks.
-   **PostgreSQL**: Primary database.
-   **Resend**: Transactional email service.
-   **Clerk**: User authentication and management.