import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertScheduledTaskSchema, insertMerchantSchema } from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";
import { getStripeClientFactory } from "./stripeClient";
import { checkUsageLimits } from "./middleware";
import { log } from "./index";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Dashboard
  app.get("/api/dashboard", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      const recentTasks = await storage.getRecentTasks(5);
      const recentActivity = await storage.getUsageLogs(undefined, undefined, 10);

      const merchantId = req.query.merchantId as string | undefined;
      let usage = { current: 0, limit: 1000 };
      
      if (merchantId) {
        const monthlyCount = await storage.getMonthlyDunningCount(merchantId);
        usage = { current: monthlyCount, limit: 1000 };
      } else {
        const merchants = await storage.getMerchants();
        if (merchants.length > 0) {
          const firstMerchant = merchants[0];
          const monthlyCount = await storage.getMonthlyDunningCount(firstMerchant.id);
          usage = { current: monthlyCount, limit: 1000 };
        }
      }

      res.json({
        stats,
        recentTasks,
        recentActivity,
        usage,
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  // Tasks
  app.get("/api/tasks", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const tasks = await storage.getTasks(status);
      res.json(tasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      console.error("Get task error:", error);
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", checkUsageLimits, async (req, res) => {
    try {
      const validated = insertScheduledTaskSchema.parse(req.body);
      const task = await storage.createTask(validated);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid task data", details: error.errors });
      }
      console.error("Create task error:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.post("/api/tasks/:id/retry", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      // Reset task to pending for retry
      const updated = await storage.updateTaskStatus(id, "pending");
      
      // Log the retry
      await storage.createUsageLog({
        merchantId: task.merchantId,
        metricType: "task_retry",
        amount: 1,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Retry task error:", error);
      res.status(500).json({ error: "Failed to retry task" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteTask(id);
      if (!deleted) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete task error:", error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.delete("/api/tasks/completed", async (req, res) => {
    try {
      const count = await storage.deleteCompletedTasks();
      res.json({ deleted: count });
    } catch (error) {
      console.error("Delete completed tasks error:", error);
      res.status(500).json({ error: "Failed to delete completed tasks" });
    }
  });

  // Merchants
  app.get("/api/merchants", async (req, res) => {
    try {
      const merchants = await storage.getMerchants();
      res.json(merchants);
    } catch (error) {
      console.error("Get merchants error:", error);
      res.status(500).json({ error: "Failed to fetch merchants" });
    }
  });

  app.get("/api/merchants/:id", async (req, res) => {
    try {
      const merchant = await storage.getMerchant(req.params.id);
      if (!merchant) {
        return res.status(404).json({ error: "Merchant not found" });
      }
      res.json(merchant);
    } catch (error) {
      console.error("Get merchant error:", error);
      res.status(500).json({ error: "Failed to fetch merchant" });
    }
  });

  app.post("/api/merchants", async (req, res) => {
    try {
      const validated = insertMerchantSchema.parse(req.body);
      const merchant = await storage.createMerchant(validated);
      res.status(201).json(merchant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid merchant data", details: error.errors });
      }
      console.error("Create merchant error:", error);
      res.status(500).json({ error: "Failed to create merchant" });
    }
  });

  // Update merchant billing info (secured via Stripe Connect ID verification)
  // IDOR Prevention: Requires X-Merchant-Stripe-Id header matching the merchant's Stripe Connect ID
  app.patch("/api/merchants/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const stripeConnectId = req.headers["x-merchant-stripe-id"] as string;

      // Require Stripe Connect ID header for authorization
      if (!stripeConnectId) {
        return res.status(401).json({ message: "Authorization required" });
      }

      const merchant = await storage.getMerchant(id);
      if (!merchant) {
        return res.status(404).json({ message: "Not found" });
      }

      // SECURE: Verify the caller knows the merchant's Stripe Connect ID
      if (merchant.stripeConnectId !== stripeConnectId) {
        log(`Security Alert: Unauthorized update for merchant ${id}`, 'security', 'error');
        return res.status(403).json({ message: "Forbidden" });
      }

      const { billingCountry, billingAddress, email } = req.body;

      const updateData: Record<string, string | null> = {};
      if (billingCountry !== undefined) updateData.billingCountry = billingCountry;
      if (billingAddress !== undefined) updateData.billingAddress = billingAddress;
      if (email !== undefined) updateData.email = email;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateMerchant(id, updateData);
      res.json(updated);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ level: "error", time: Date.now(), msg: `Update merchant error: ${errorMessage}`, source: "routes" }));
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // Activity Logs
  app.get("/api/activity", async (req, res) => {
    try {
      const metricType = req.query.metricType as string | undefined;
      const logs = await storage.getUsageLogs(undefined, metricType, 100);
      res.json(logs);
    } catch (error) {
      console.error("Get activity error:", error);
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Worker endpoint - claims next task for processing
  app.post("/api/worker/claim", async (req, res) => {
    try {
      const task = await storage.claimNextTask();
      if (!task) {
        return res.json({ task: null });
      }
      res.json({ task });
    } catch (error) {
      console.error("Claim task error:", error);
      res.status(500).json({ error: "Failed to claim task" });
    }
  });

  // Worker endpoint - complete task
  app.post("/api/worker/complete/:id", async (req, res) => {
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
      console.error("Complete task error:", error);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  // Stripe Connect OAuth - Authorize endpoint
  app.post("/api/stripe/connect/authorize", async (req, res) => {
    try {
      const clientId = process.env.STRIPE_CLIENT_ID;
      
      if (!clientId) {
        return res.status(500).json({ 
          error: "Stripe Connect not configured",
          message: "STRIPE_CLIENT_ID environment variable is required"
        });
      }

      const state = crypto.randomBytes(32).toString('hex');

      const merchant = await storage.createMerchant({
        oauthState: state,
        tier: "FREE",
      });

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
      console.error("Stripe connect authorize error:", error);
      res.status(500).json({ error: "Failed to initiate Stripe Connect" });
    }
  });

  // Stripe Connect OAuth - Callback endpoint
  app.get("/api/stripe/connect/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError, error_description } = req.query;

      if (oauthError) {
        console.error("OAuth error:", oauthError, error_description);
        return res.redirect(`/?error=${encodeURIComponent(error_description as string || 'OAuth failed')}`);
      }

      if (!code || !state) {
        return res.redirect('/?error=Missing authorization code or state');
      }

      const merchant = await storage.getMerchantByOAuthState(state as string);
      
      if (!merchant) {
        console.error("Invalid OAuth state:", state);
        return res.redirect('/?error=Invalid or expired state token');
      }

      const factory = await getStripeClientFactory();
      const platformClient = factory.getPlatformClient();

      const response = await platformClient.oauth.token({
        grant_type: 'authorization_code',
        code: code as string,
      });

      await storage.updateMerchant(merchant.id, {
        stripeConnectId: response.stripe_user_id,
        stripeUserId: response.stripe_user_id,
        accessToken: response.access_token,
        refreshToken: response.refresh_token || null,
        oauthState: null,
      });

      await storage.createUsageLog({
        merchantId: merchant.id,
        metricType: 'merchant_connected',
        amount: 1,
      });

      console.log(`Merchant ${merchant.id} connected with Stripe account ${response.stripe_user_id}`);

      res.redirect('/?connected=true');
    } catch (error: any) {
      console.error("Stripe connect callback error:", error);
      res.redirect(`/?error=${encodeURIComponent(error.message || 'Connection failed')}`);
    }
  });

  // Stripe Connect - Disconnect (Kill Switch)
  app.post("/api/stripe/disconnect", async (req, res) => {
    try {
      const { merchantId } = req.body;
      
      if (!merchantId) {
        return res.status(400).json({ message: "merchantId is required" });
      }

      const merchant = await storage.getMerchant(merchantId);
      
      if (!merchant) {
        return res.status(404).json({ message: "Merchant not found" });
      }

      if (!merchant.stripeConnectId) {
        return res.status(400).json({ message: "Merchant is not connected to Stripe" });
      }

      const factory = await getStripeClientFactory();
      const platformClient = factory.getPlatformClient();

      // Step 1: Cancel all active subscriptions for this connected account
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
          console.log(`Cancelled subscription ${sub.id} for merchant ${merchantId}`);
        }
      } catch (subError: any) {
        console.warn(`Failed to cancel subscriptions for merchant ${merchantId}:`, subError.message);
      }

      // Step 2: Deauthorize OAuth connection (optional but recommended)
      try {
        const clientId = process.env.STRIPE_CLIENT_ID;
        if (clientId && merchant.stripeUserId) {
          await platformClient.oauth.deauthorize({
            client_id: clientId,
            stripe_user_id: merchant.stripeUserId,
          }, {
            idempotencyKey: `deauth_${merchantId}_${merchant.stripeUserId}`,
          });
          console.log(`Deauthorized Stripe account ${merchant.stripeUserId}`);
        }
      } catch (deauthError: any) {
        console.warn(`Failed to deauthorize merchant ${merchantId}:`, deauthError.message);
      }

      // Step 3: Clear Stripe credentials from database
      await storage.updateMerchant(merchantId, {
        stripeConnectId: null,
        stripeUserId: null,
        accessToken: null,
        refreshToken: null,
      });

      // Step 4: Delete pending/running tasks
      const deletedTasks = await storage.deletePendingTasks(merchantId);
      console.log(`Deleted ${deletedTasks} pending tasks for merchant ${merchantId}`);

      // Log the disconnection
      await storage.createUsageLog({
        merchantId,
        metricType: 'merchant_disconnected',
        amount: 1,
      });

      console.log(`Merchant ${merchantId} disconnected successfully`);
      
      res.json({ success: true, deletedTasks });
    } catch (error: any) {
      console.error("Stripe disconnect error:", error);
      res.status(500).json({ message: "Failed to disconnect from Stripe" });
    }
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json({
        status: "healthy",
        database: "connected",
        pendingTasks: stats.pendingTasks,
        runningTasks: stats.runningTasks,
      });
    } catch (error) {
      res.status(500).json({ status: "unhealthy", error: "Database connection failed" });
    }
  });

  return httpServer;
}
