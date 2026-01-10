-- Performance tuning for high-throughput task queue tables
-- Aggressive autovacuum settings for tables with frequent updates/deletes

ALTER TABLE scheduled_tasks SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE processed_events SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE usage_logs SET (autovacuum_vacuum_scale_factor = 0.05);
