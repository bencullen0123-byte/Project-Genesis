import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertScheduledTaskSchema, insertMerchantSchema } from "@shared/schema";
import { z } from "zod";

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

      res.json({
        stats,
        recentTasks,
        recentActivity,
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

  app.post("/api/tasks", async (req, res) => {
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

  // Stripe Connect OAuth placeholder
  app.post("/api/stripe/connect/authorize", async (req, res) => {
    try {
      // In production, this would redirect to Stripe OAuth
      // For now, return a placeholder
      res.json({ 
        url: null, 
        message: "Stripe Connect OAuth flow would be initiated here" 
      });
    } catch (error) {
      console.error("Stripe connect error:", error);
      res.status(500).json({ error: "Failed to initiate Stripe Connect" });
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
