ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "billing_country" text;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "billing_address" text;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "email" text;
