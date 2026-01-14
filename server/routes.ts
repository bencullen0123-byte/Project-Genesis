import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertScheduledTaskSchema, insertMerchantSchema } from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";
import Stripe from "stripe";
import { getStripeClientFactory } from "./stripeClient";
import { checkUsageLimits, requireMerchant } from "./middleware";
import { log } from "./index";
import { requireAuth } from '@clerk/express';
import { PLANS } from '@shared/plans';
import { handleStripeWebhook } from "./webhookHandlers";
import DOMPurify from 'isomorphic-dompurify';

// HMAC utility for secure tracking links (Ticket 23.2)
const APP_SECRET = process.env.SESSION_SECRET || 'dev-secret-do-not-use-in-prod';

export function generateTrackingSignature(url: string, logId: string): string {
  return crypto.createHmac('sha256', APP_SECRET)
    .update(`${url}:${logId}`)
    .digest('hex');
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Dashboard (protected - requires authenticated merchant)
  app.get("/api/dashboard", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const merchant = req.merchant!;
      const stats = await storage.getDashboardStats(merchant.id);
      const recentTasks = await storage.getRecentTasks(merchant.id, 5);
      const recentActivity = await storage.getUsageLogs(merchant.id, undefined, 10);

      const monthlyCount = await storage.getMonthlyDunningCount(merchant.id);
      const planId = merchant.subscriptionPlanId || 'price_free';
      const planConfig = PLANS[planId] ?? PLANS['default'];
      const usage = { current: monthlyCount, limit: planConfig.limit };

      res.json({
        stats,
        recentTasks,
        recentActivity,
        usage,
        merchant: {
          id: merchant.id,
          email: merchant.email,
          tier: merchant.tier,
          stripeConnected: !!merchant.stripeConnectId,
        },
      });
    } catch (error) {
      log(`Dashboard error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  // Current merchant info
  app.get("/api/merchants/me", requireAuth(), requireMerchant, async (req, res) => {
    const merchant = req.merchant!;
    res.json({
      id: merchant.id,
      email: merchant.email,
      tier: merchant.tier,
      stripeConnected: !!merchant.stripeConnectId,
      subscriptionPlanId: merchant.subscriptionPlanId,
      createdAt: merchant.createdAt,
    });
  });

  // Tasks (protected)
  app.get("/api/tasks", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const tasks = await storage.getTasks(req.merchant!.id, status);
      res.json(tasks);
    } catch (error) {
      log(`Get tasks error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      // SECURITY GATE: Ownership check
      if (task.merchantId !== req.merchant!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      res.json(task);
    } catch (error) {
      log(`Get task error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  // SECURED: Create Task (User Initiated - Whitelist Enforced)
  app.post(
    "/api/tasks",
    requireAuth(),      // 1. Authenticate
    requireMerchant,    // 2. Load Merchant Context
    checkUsageLimits,   // 3. Enforce Quotas
    async (req, res) => {
      try {
        const { taskType, payload } = req.body;

        // 1. STRICT WHITELIST
        // Only allow specific tasks to be triggered by the frontend.
        // 'report_usage' and 'weekly_digest' are SYSTEM ONLY and must be rejected.
        const ALLOWED_TYPES = ['dunning_retry', 'notify_action_required'];
        
        if (!ALLOWED_TYPES.includes(taskType)) {
          log(`Blocked unauthorized task type injection: ${taskType} by merchant ${req.merchant!.id}`, 'security', 'warn');
          return res.status(400).json({ message: "Invalid or unauthorized task type" });
        }

        // 2. QUEUE FLOOD PREVENTION (Dynamic)
        // Check how many tasks are currently pending for this merchant
        const pendingCount = await storage.getPendingTasksCount(req.merchant!.id);
        
        // Lookup Plan Limits
        const planKey = req.merchant!.subscriptionPlanId || 'default';
        const planConfig = PLANS[planKey] || PLANS['default'];
        const maxQueue = planConfig.queueLimit;
        
        if (pendingCount >= maxQueue) {
          log(`Queue limit reached for merchant ${req.merchant!.id} (${pendingCount}/${maxQueue})`, 'security', 'warn');
          return res.status(429).json({ 
            message: `Queue limit reached (${pendingCount}/${maxQueue}). Upgrade your plan to increase concurrency.` 
          });
        }

        // 3. FORCE SERVER AUTHORITY
        // We ignore 'status', 'runAt', and 'merchantId' from the body.
        // We force them to safe defaults.
        const task = await storage.createTask({
          merchantId: req.merchant!.id, // Enforce Session Ownership
          taskType,
          payload: payload || {},
          status: 'pending', // FORCE: User cannot inject 'completed' tasks
          runAt: new Date(), // FORCE: User cannot schedule future system tasks
        });

        log(`User-initiated task created: ${taskType} for merchant ${req.merchant!.id}`, 'routes');
        res.status(201).json(task);

      } catch (error) {
        log(`Failed to create task: ${error}`, 'routes', 'error');
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post("/api/tasks/:id/retry", requireAuth(), requireMerchant, checkUsageLimits, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      // SECURITY GATE: Ownership check
      if (task.merchantId !== req.merchant!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      // Reset task to pending for retry
      const updated = await storage.updateTaskStatus(id, "pending");
      
      // Log the retry (counts against the quota we just checked)
      await storage.createUsageLog({
        merchantId: task.merchantId,
        metricType: "task_retry",
        amount: 1,
      });
      
      res.json(updated);
    } catch (error) {
      log(`Retry task error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to retry task" });
    }
  });

  app.delete("/api/tasks/:id", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      // SECURITY GATE: Ownership check
      if (task.merchantId !== req.merchant!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      const deleted = await storage.deleteTask(id);
      res.json({ success: true });
    } catch (error) {
      log(`Delete task error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.delete("/api/tasks/completed", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const count = await storage.deleteCompletedTasks(req.merchant!.id);
      res.json({ deleted: count });
    } catch (error) {
      log(`Delete completed tasks error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to delete completed tasks" });
    }
  });

  // Update merchant billing info (ownership via authenticated merchant)
  app.patch("/api/merchants/:id", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Ownership check: only allow updating your own merchant record
      if (id !== req.merchant!.id) {
        log(`Security Alert: Unauthorized update attempt for merchant ${id} by ${req.merchant!.id}`, 'security', 'error');
        return res.sendStatus(403);
      }

      // SECURITY: Email removed from allowed fields to prevent spoofing
      const { 
        billingCountry, 
        billingAddress, 
        brandColor, 
        logoUrl, 
        fromName, 
        supportEmail 
      } = req.body;

      const updateData: Record<string, string | null> = {};
      if (billingCountry !== undefined) updateData.billingCountry = billingCountry;
      if (billingAddress !== undefined) updateData.billingAddress = billingAddress;
      if (fromName !== undefined) updateData.fromName = fromName;
      if (supportEmail !== undefined) updateData.supportEmail = supportEmail;

      // 1. HEX COLOR VALIDATION
      if (brandColor !== undefined) {
        const hexRegex = /^#[0-9A-Fa-f]{6}$/;
        if (!hexRegex.test(brandColor)) {
          return res.status(400).json({ message: "Invalid hex color format (e.g. #FF0000)" });
        }
        updateData.brandColor = brandColor;
      }

      // 2. LOGO URL PROTOCOL CHECK
      if (logoUrl !== undefined) {
        if (logoUrl && !logoUrl.startsWith('https://')) {
          return res.status(400).json({ message: "Logo URL must use secure HTTPS protocol" });
        }
        updateData.logoUrl = logoUrl;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateMerchant(id, updateData);
      
      if (!updated) {
        return res.status(404).json({ message: "Merchant not found" });
      }
      
      // SECURE: Whitelist response fields to prevent leaking sensitive data
      res.json({
        id: updated.id,
        email: updated.email,
        billingCountry: updated.billingCountry,
        billingAddress: updated.billingAddress,
        brandColor: updated.brandColor,
        logoUrl: updated.logoUrl,
        fromName: updated.fromName,
        supportEmail: updated.supportEmail,
        tier: updated.tier,
        stripeConnectId: updated.stripeConnectId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Update merchant error: ${errorMessage}`, 'routes', 'error');
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // EMAIL TEMPLATE MANAGEMENT (SECURED)
  app.post("/api/email-templates", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const { retryAttempt, subject, body } = req.body;

      if (![1, 2, 3].includes(retryAttempt)) {
        return res.status(400).json({ message: "Invalid retry attempt (must be 1, 2, or 3)" });
      }

      if (!subject || !body) {
        return res.status(400).json({ message: "Subject and body are required" });
      }

      // SECURITY: DOM SANITIZATION
      // Strips <script>, <onmouseover>, etc., while keeping safe layout tags
      const sanitizedBody = DOMPurify.sanitize(body);

      const template = await storage.createOrUpdateEmailTemplate(req.merchant!.id, {
        retryAttempt,
        subject: subject.substring(0, 200), // Subject length limit
        body: sanitizedBody
      });

      res.status(201).json(template);
    } catch (error) {
      log(`Template update error: ${error}`, 'routes', 'error');
      res.status(500).json({ message: "Failed to save template" });
    }
  });

  // Activity Logs (protected - only show authenticated merchant's logs)
  app.get("/api/activity", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const metricType = req.query.metricType as string | undefined;
      const logs = await storage.getUsageLogs(req.merchant!.id, metricType, 100);
      res.json(logs);
    } catch (error) {
      log(`Get activity error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Worker authentication middleware (timing-safe comparison)
  const requireWorkerAuth = (req: any, res: any, next: any) => {
    const expectedSecret = process.env.WORKER_SECRET;
    if (!expectedSecret) {
      log("Worker secret not configured", "security", "error");
      return res.status(500).json({ error: "Server configuration error" });
    }
    
    const providedSecret = req.headers['x-worker-secret'] || '';
    const providedBuffer = Buffer.from(String(providedSecret));
    const expectedBuffer = Buffer.from(expectedSecret);
    
    if (providedBuffer.length !== expectedBuffer.length || 
        !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      log(`Unauthorized worker access attempt from ${req.ip}`, "security", "warn");
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  // Worker endpoint - claims next task for processing
  app.post("/api/worker/claim", requireWorkerAuth, async (req, res) => {
    try {
      const task = await storage.claimNextTask();
      if (!task) {
        return res.json({ task: null });
      }
      res.json({ task });
    } catch (error) {
      log(`Claim task error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to claim task" });
    }
  });

  // Worker endpoint - complete task
  app.post("/api/worker/complete/:id", requireWorkerAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { success, recoveredCents } = req.body;
      
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      const status = success ? "completed" : "failed";
      await storage.updateTaskStatus(id, status);

      // Log the result
      await storage.createUsageLog({
        merchantId: task.merchantId,
        metricType: success ? "recovery_success" : "recovery_failed",
        amount: 1,
      });

      // Update daily metrics if successful
      if (success && recoveredCents) {
        await storage.updateDailyMetrics(task.merchantId, recoveredCents);
      }

      res.json({ success: true });
    } catch (error) {
      log(`Complete task error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  // Stripe Connect OAuth - Authorize endpoint (protected)
  app.post("/api/stripe/connect/authorize", requireAuth(), requireMerchant, async (req, res) => {
    try {
      const merchant = req.merchant!;
      const clientId = process.env.STRIPE_CLIENT_ID;
      
      if (!clientId) {
        return res.status(500).json({ 
          error: "Stripe Connect not configured",
          message: "STRIPE_CLIENT_ID environment variable is required"
        });
      }

      const state = crypto.randomBytes(32).toString('hex');

      await storage.updateMerchant(merchant.id, { oauthState: state });

      const authorizeUrl = new URL('https://connect.stripe.com/oauth/authorize');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('scope', 'read_write');
      authorizeUrl.searchParams.set('state', state);

      res.json({ 
        url: authorizeUrl.toString(),
        state,
        merchantId: merchant.id,
      });
    } catch (error) {
      log(`Stripe connect authorize error: ${error}`, 'routes', 'error');
      res.status(500).json({ error: "Failed to initiate Stripe Connect" });
    }
  });

  // SECURE: Stripe Connect OAuth Callback (CSRF Protected)
  app.get(
    "/api/stripe/connect/callback",
    requireAuth(),     // 1. Must be logged in via Clerk
    requireMerchant,   // 2. Must have a merchant record
    async (req, res) => {
      try {
        const { code, state, error: oauthError, error_description } = req.query;
        const merchant = req.merchant!; // 3. Use the SESSION merchant, not a DB lookup

        // A. Handle Stripe Errors
        if (oauthError) {
          log(`OAuth error: ${oauthError} - ${error_description}`, 'routes', 'error');
          return res.redirect(`/?error=${encodeURIComponent(error_description as string || 'OAuth failed')}`);
        }

        // B. Validate Inputs
        if (!code || !state) {
          return res.redirect('/?error=Missing authorization code or state');
        }

        // C. CSRF CHECK (The Fix)
        // Ensure the state in the URL matches the state we saved in the user's DB record
        if (!merchant.oauthState || merchant.oauthState !== state) {
          log(`CSRF Mismatch for merchant ${merchant.id}. State verification failed.`, 'security', 'error');
          return res.redirect('/?error=Security violation: Invalid or expired state token');
        }

        // D. Token Exchange (Proceed as normal)
        const factory = await getStripeClientFactory();
        const platformClient = factory.getPlatformClient();

        const response = await platformClient.oauth.token({
          grant_type: 'authorization_code',
          code: code as string,
        });

        // E. Save Credentials & Clear State
        await storage.updateMerchant(merchant.id, {
          stripeConnectId: response.stripe_user_id,
          stripeUserId: response.stripe_user_id,
          accessToken: response.access_token,
          refreshToken: response.refresh_token || null,
          oauthState: null, // Clear state to prevent replay
        });

        await storage.createUsageLog({
          merchantId: merchant.id,
          metricType: 'merchant_connected',
          amount: 1,
        });

        log(JSON.stringify({
          msg: 'Merchant connected',
          merchantId: merchant.id,
          stripeUserId: response.stripe_user_id
        }), 'auth');

        res.redirect('/?connected=true');
      } catch (error: any) {
        log(`Stripe connect callback error: ${error.message || error}`, 'routes', 'error');
        res.redirect(`/?error=${encodeURIComponent(error.message || 'Connection failed')}`);
      }
    }
  );

  // SECURED: Stripe Connect - Disconnect (Kill Switch)
  // Uses requireAuth() + requireMerchant middleware - ignores request body
  app.post("/api/stripe/disconnect", requireAuth(), requireMerchant, async (req, res) => {
    try {
      // SECURITY FIX: Do not read merchantId from body. Use the session.
      const merchantId = req.merchant!.id;

      const merchant = await storage.getMerchant(merchantId);
      if (!merchant) {
        return res.status(404).json({ message: "Merchant not found" });
      }

      if (!merchant.stripeConnectId) {
        return res.status(400).json({ message: "Merchant is not connected to Stripe" });
      }

      const factory = await getStripeClientFactory();
      const platformClient = factory.getPlatformClient();

      // Step 1: Cancel all active subscriptions for this connected account (Best Effort)
      try {
        const tenantClient = await factory.getClient(merchantId);
        const subscriptions = await tenantClient.subscriptions.list({
          status: 'active',
          limit: 100,
        });

        for (const sub of subscriptions.data) {
          await tenantClient.subscriptions.cancel(sub.id, undefined, {
            idempotencyKey: `cancel_sub_${merchantId}_${sub.id}`,
          });
        }
      } catch (subError: any) {
        log(`Failed to cancel subscriptions during disconnect: ${subError.message}`, 'stripe', 'warn');
      }

      // Step 2: Deauthorize OAuth connection (Revoke Access)
      try {
        const clientId = process.env.STRIPE_CLIENT_ID;
        if (clientId && merchant.stripeUserId) {
          await platformClient.oauth.deauthorize({
            client_id: clientId,
            stripe_user_id: merchant.stripeUserId,
          }, {
            idempotencyKey: `deauth_${merchantId}_${merchant.stripeUserId}`,
          });
        }
      } catch (deauthError: any) {
        log(`Failed to deauthorize Stripe account: ${deauthError.message}`, 'stripe', 'warn');
      }

      // Step 3: Wipe Credentials from DB
      await storage.updateMerchant(merchantId, {
        stripeConnectId: null,
        stripeUserId: null,
        accessToken: null,
        refreshToken: null,
      });

      // Step 4: Kill Zombie Tasks (Cleanup) - ticket 11.3 ensures this kills running tasks too
      await storage.deletePendingTasks(merchantId);

      await storage.createUsageLog({
        merchantId,
        metricType: 'merchant_disconnected',
        amount: 1,
      });

      log(`Merchant ${merchantId} disconnected from Stripe`, 'stripe');
      res.json({ success: true });

    } catch (error: any) {
      log(`Stripe disconnect error: ${error}`, 'routes', 'error');
      res.status(500).json({ message: "Failed to disconnect from Stripe" });
    }
  });

  // STRIPE WEBHOOK LISTENER
  // This must be publicly accessible to receive events from Stripe.
  // Note: In production, verify req.headers['stripe-signature'] here.
  app.post("/api/webhooks/stripe", async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret || !signature) {
      log("Webhook failed: Missing configuration", "stripe", "error");
      return res.status(400).send("Webhook Error: Configuration missing");
    }

    let event: Stripe.Event;

    try {
      // CRYPTOGRAPHIC VERIFICATION
      event = Stripe.webhooks.constructEvent(
        (req as any).rawBody,
        signature as string,
        secret
      );
    } catch (err: any) {
      // SECURITY LOGGING (Enhanced with IP)
      log(`⚠️ Security Alert: Webhook signature verification failed from IP ${req.ip}: ${err.message}`, "stripe", "error");
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // PASS VERIFIED EVENT
      const result = await handleStripeWebhook(event);
      res.json(result);
    } catch (err: any) {
      log(`Webhook processing error: ${err.message}`, "stripe", "error");
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });

  // GDPR Right to Erasure (Article 17) - Admin Only
  app.delete("/api/admin/merchants/:id", async (req, res) => {
    const adminKey = req.headers['x-admin-key'] as string | undefined;
    const envAdminKey = process.env.ADMIN_KEY;

    // Fail safe: reject all if ADMIN_KEY not configured
    if (!envAdminKey) {
      log('GDPR erasure rejected: ADMIN_KEY not configured', 'admin', 'warn');
      res.status(403).json({ error: 'Forbidden', message: 'Admin access not configured' });
      return;
    }

    // Use constant-time comparison to prevent timing attacks
    const providedBuffer = Buffer.from(adminKey || '');
    const correctBuffer = Buffer.from(envAdminKey);
    
    if (providedBuffer.length !== correctBuffer.length || 
        !crypto.timingSafeEqual(providedBuffer, correctBuffer)) {
      log('GDPR erasure rejected: invalid admin key', 'admin', 'warn');
      res.status(403).json({ error: 'Forbidden', message: 'Invalid admin credentials' });
      return;
    }

    const merchantId = req.params.id;

    try {
      // Verify merchant exists
      const merchant = await storage.getMerchant(merchantId);
      if (!merchant) {
        res.status(404).json({ error: 'Not Found', message: 'Merchant not found' });
        return;
      }

      // STRIPE DE-PROVISIONING: Cancel subscriptions and revoke access before DB delete
      // KILL SWITCH: If this fails, we MUST abort to prevent zombie billing
      if (merchant.stripeConnectId) {
        try {
          const factory = await getStripeClientFactory();
          const stripe = await factory.getClient(merchantId);
          
          // List and cancel all active subscriptions for this connected account
          const subscriptions = await stripe.subscriptions.list({
            limit: 100,
            status: 'active',
          });
          
          for (const sub of subscriptions.data) {
            await stripe.subscriptions.cancel(sub.id);
            log(`Cancelled subscription ${sub.id} for merchant ${merchantId}`, 'admin');
          }
          
          log(`Stripe de-provisioned for merchant ${merchantId}`, 'admin');
        } catch (stripeError: any) {
          // CRITICAL FIX: STOP EVERYTHING
          // If we delete the DB record now, we create a "Zombie User" (Billed but no login).
          log(`ABORTING ERASURE: Stripe de-provisioning failed for ${merchantId}: ${stripeError.message}`, 'admin', 'error');
          
          res.status(502).json({ 
            error: 'Upstream Error', 
            message: 'Failed to cancel Stripe subscriptions. Data NOT deleted to prevent zombie billing. Please retry.' 
          });
          return;
        }
      }

      // GDPR Hard Delete: Remove ALL tasks (pending, running, completed, failed)
      const deletedTasks = await storage.deleteAllTasksForMerchant(merchantId);
      
      // Delete usage logs
      const deletedLogs = await storage.deleteUsageLogs(merchantId);
      
      // Delete daily metrics (GDPR compliance - no data residue)
      const deletedMetrics = await storage.deleteDailyMetrics(merchantId);
      
      // Delete merchant record
      await storage.deleteMerchant(merchantId);

      log(JSON.stringify({
        msg: 'GDPR Erasure executed',
        merchantId,
        deletedTasks,
        deletedLogs,
        deletedMetrics
      }), 'admin');

      res.json({ 
        success: true, 
        message: 'Merchant data permanently erased',
        deleted: {
          tasks: deletedTasks,
          usageLogs: deletedLogs,
          dailyMetrics: deletedMetrics
        }
      });
    } catch (error: any) {
      log(`GDPR erasure failed for merchant ${merchantId}: ${error.message}`, 'admin', 'error');
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to erase merchant data' });
    }
  });

  // ===============================================
  // TRACKING ENDPOINTS (Ticket 23.2)
  // ===============================================

  // Open Pixel - Records email opens and serves a 1x1 transparent GIF
  app.get("/api/track/open/:logId", async (req, res) => {
    const logId = parseInt(req.params.logId);
    
    try {
      // 1. Log the interaction and increment metrics (Atomic update)
      await storage.recordEmailOpen(logId);
      
      // 2. Serve a 1x1 transparent GIF
      const pixel = Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", 
        "base64"
      );
      res.set({
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      res.send(pixel);
    } catch (error) {
      // Fail silently to the user, but log for us
      log(`Pixel tracking error for log ${logId}: ${error}`, 'tracking', 'error');
      res.status(200).send(); // Always return 200 for pixels
    }
  });

  // Signed Click Redirector - Verifies HMAC signature before recording click
  app.get("/api/track/click", async (req, res) => {
    const { url, logId, sig } = req.query as { url: string; logId: string; sig: string };

    if (!url || !logId || !sig) {
      return res.status(400).send("Missing tracking parameters");
    }

    // SECURITY: Verify the HMAC signature
    const expectedSig = generateTrackingSignature(url, logId);
    if (sig !== expectedSig) {
      log(`Invalid tracking signature detected for log ${logId}`, 'security', 'warn');
      return res.status(403).send("Invalid tracking signature");
    }

    try {
      // 1. Log the click and increment metrics
      await storage.recordEmailClick(parseInt(logId));
      
      // 2. Redirect to destination
      res.redirect(url);
    } catch (error) {
      log(`Link tracking error for log ${logId}: ${error}`, 'tracking', 'error');
      res.redirect(url); // Redirect anyway so user isn't stuck
    }
  });

  // Health check (unauthenticated - uses a basic DB query instead of scoped stats)
  app.get("/api/health", async (req, res) => {
    try {
      // Simple health check - just verify DB is reachable
      const merchants = await storage.getMerchants();
      res.json({
        status: "healthy",
        database: "connected",
        merchantsCount: merchants.length,
      });
    } catch (error) {
      res.status(500).json({ status: "unhealthy", error: "Database connection failed" });
    }
  });

  return httpServer;
}
