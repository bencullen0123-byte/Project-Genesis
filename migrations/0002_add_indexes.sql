CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status_run_at ON scheduled_tasks (status, run_at);
CREATE INDEX IF NOT EXISTS idx_merchants_stripe_connect_id ON merchants (stripe_connect_id);
