-- Add clerk_user_id column for Clerk authentication
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_merchants_clerk_user ON merchants (clerk_user_id);
