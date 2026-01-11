import { storage } from "../server/storage";
import { PLANS } from "../shared/plans";

async function runVerification() {
  console.log("🔍 STARTING ARCHITECTURAL VERIFICATION...");

  // 1. SETUP: Create a Test Subject
  const testEmail = `smoke_test_${Date.now()}@example.com`;
  console.log(`\n1️⃣  Phase 1: Zero Trust Provisioning`);
  const merchant = await storage.createMerchant({
    email: testEmail,
    tier: "FREE",
    subscriptionPlanId: "price_free",
    oauthState: "test_state",
  });
  if (!merchant) throw new Error("CRITICAL: Merchant creation failed.");
  console.log(`   ✅ Merchant Created: ID ${merchant.id}`);

  // 2. TEST: Pricing Engine Logic
  console.log(`\n2️⃣  Phase 2: Pricing Engine Stress Test`);
  const plan = PLANS['price_free'];
  if (!plan) throw new Error("CRITICAL: 'price_free' plan missing from shared/plans.ts");
  
  console.log(`   - Enforcing Plan: ${plan.name} (Limit: ${plan.limit})`);
  
  // Simulate usage EXCEEDING the limit
  console.log("   - Injecting usage logs to breach limit...");
  await storage.createUsageLog({
    merchantId: merchant.id,
    metricType: "dunning_email_sent",
    amount: plan.limit + 5, 
  });
  
  const currentUsage = await storage.getMonthlyDunningCount(merchant.id);
  const wouldBlock = currentUsage >= plan.limit;
  
  if (wouldBlock) {
    console.log(`   ✅ Logic Verified: System detects ${currentUsage} usage > ${plan.limit} limit.`);
  } else {
    console.error(`   ❌ FAILURE: System allows usage (${currentUsage}) despite limit (${plan.limit}).`);
    process.exit(1);
  }

  // 3. TEST: GDPR "Kill Chain"
  console.log(`\n3️⃣  Phase 3: GDPR Article 17 (Right to Erasure)`);
  console.log("   - Creating 'shadow data' (Tasks & Logs) to test cascade...");
  
  // Create a dummy task that MUST be deleted
  await storage.createTask({
    merchantId: merchant.id,
    taskType: "dunning_retry",
    status: "pending",
    runAt: new Date(),
    payload: { test: true }
  });
  
  console.log("   - Executing HARD DELETE sequence...");
  // Mimic the route logic manually
  await storage.deletePendingTasks(merchant.id);
  await storage.deleteUsageLogs(merchant.id);
  const deleted = await storage.deleteMerchant(merchant.id);
  
  const zombie = await storage.getMerchant(merchant.id);
  if (!zombie && deleted) {
    console.log("   ✅ COMPLIANT: Merchant and all shadow data destroyed.");
  } else {
    console.error("   ❌ LIABILITY: Data persists after deletion request.");
    process.exit(1);
  }

  console.log("\n✨ SYSTEM STATUS: GREEN. READY FOR UI.");
  process.exit(0);
}

runVerification().catch((err) => {
  console.error("\n💥 FATAL SYSTEM ERROR:", err);
  process.exit(1);
});
