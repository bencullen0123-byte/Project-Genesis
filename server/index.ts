import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { getStripeClientFactory, getStripeSecretKey } from './stripeClient';
import { handleStripeWebhook } from './webhookHandlers';
import { startWorker } from './worker';
import { storage } from './storage';
import Stripe from 'stripe';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { runCleanup } from './cron';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function databaseWarmup() {
  try {
    log('Applying database performance tuning...', 'db');
    
    await db.execute(sql`ALTER TABLE scheduled_tasks SET (autovacuum_vacuum_scale_factor = 0.01)`);
    await db.execute(sql`ALTER TABLE processed_events SET (autovacuum_vacuum_scale_factor = 0.01)`);
    await db.execute(sql`ALTER TABLE usage_logs SET (autovacuum_vacuum_scale_factor = 0.05)`);
    
    log('Database performance tuning applied', 'db');
  } catch (error: any) {
    log(`Database warmup warning: ${error.message}`, 'db');
  }
}

async function initStripe() {
  try {
    log('Initializing Stripe client factory...', 'stripe');
    const factory = await getStripeClientFactory();
    log('Stripe client factory ready', 'stripe');

    // Validate Stripe Connect OAuth prerequisites
    if (!process.env.STRIPE_CLIENT_ID) {
      log('CRITICAL: STRIPE_CLIENT_ID is missing. OAuth will fail.', 'stripe');
    } else {
      log(`Stripe Connect Client ID configured: ${process.env.STRIPE_CLIENT_ID.substring(0, 10)}...`, 'stripe');
    }

    // Output required redirect URI for Stripe Dashboard configuration
    const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
    if (replitDomain) {
      const redirectUri = `https://${replitDomain}/api/stripe/connect/callback`;
      log(`REQUIRED STRIPE REDIRECT URI: ${redirectUri}`, 'stripe');
    } else {
      log('Warning: REPLIT_DOMAINS not set, cannot determine redirect URI', 'stripe');
    }

    const platformClient = factory.getPlatformClient();
    
    log('Setting up webhook endpoint...', 'stripe');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookUrl = `${webhookBaseUrl}/api/stripe/webhook`;
    
    // Mandatory webhook secret validation
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        log('CRITICAL: STRIPE_WEBHOOK_SECRET is missing. Production environment cannot verify webhooks.', 'stripe');
        process.exit(1);
      } else {
        log('WARNING: STRIPE_WEBHOOK_SECRET not set - signature verification will be skipped in dev mode', 'stripe');
      }
    }
    
    try {
      const existingWebhooks = await platformClient.webhookEndpoints.list({ limit: 100 });
      const existingWebhook = existingWebhooks.data.find(wh => wh.url === webhookUrl);
      
      if (existingWebhook) {
        log(`Using existing webhook: ${existingWebhook.id}`, 'stripe');
      } else {
        const newWebhook = await platformClient.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: [
            'invoice.payment_failed',
            'invoice.payment_succeeded',
            'invoice.payment_action_required',
            'customer.subscription.deleted',
            'charge.failed',
          ],
        });
        log(`Created webhook: ${newWebhook.id}`, 'stripe');
      }
    } catch (webhookError: any) {
      log(`Webhook setup skipped: ${webhookError.message}`, 'stripe');
    }
  } catch (error: any) {
    log(`Failed to initialize Stripe: ${error.message}`, 'stripe');
  }
}

async function bootstrapReporter() {
  try {
    const hasTask = await storage.hasReportUsageTask();
    if (!hasTask) {
      log('Bootstrapping report_usage task...', 'reporter');
      await storage.createTask({
        merchantId: 'system',
        taskType: 'report_usage',
        payload: { scheduledBy: 'bootstrap' },
        status: 'pending',
        runAt: new Date(),
      });
      log('report_usage task created', 'reporter');
    } else {
      log('report_usage task already exists', 'reporter');
    }
  } catch (error: any) {
    log(`Failed to bootstrap reporter: ${error.message}`, 'reporter');
  }
}

async function bootstrapWeeklyDigests() {
  try {
    const merchants = await storage.getMerchants();
    let created = 0;
    
    for (const merchant of merchants) {
      const hasDigestTask = await storage.hasWeeklyDigestTask(merchant.id);
      if (!hasDigestTask) {
        await storage.createTask({
          merchantId: merchant.id,
          taskType: 'send_weekly_digest',
          payload: { scheduledBy: 'bootstrap' },
          status: 'pending',
          runAt: new Date(),
        });
        created++;
      }
    }
    
    if (created > 0) {
      log(`Created ${created} weekly digest tasks for merchants`, 'digest');
    } else {
      log('All merchants have weekly digest tasks', 'digest');
    }
  } catch (error: any) {
    log(`Failed to bootstrap weekly digests: ${error.message}`, 'digest');
  }
}

(async () => {
  await databaseWarmup();
  await initStripe();
  await bootstrapReporter();
  await bootstrapWeeklyDigests();

  // Security headers via helmet
  app.use(helmet());
  log('Security headers enabled via helmet', 'security');

  // Global rate limiter: 100 requests per 15 minutes
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use(globalLimiter);
  log('Global rate limiter enabled (100 req/15 min)', 'security');

  // Strict webhook rate limiter: 5 requests per minute per IP
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Webhook rate limit exceeded' },
  });

  app.post(
    '/api/stripe/webhook',
    webhookLimiter,
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          log('Webhook error: req.body is not a Buffer', 'stripe');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        if (!webhookSecret) {
          log('Webhook rejected: STRIPE_WEBHOOK_SECRET not configured', 'stripe');
          return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const secretKey = await getStripeSecretKey();
        const stripe = new Stripe(secretKey, { apiVersion: '2025-11-17.clover' });

        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        log(`Webhook signature verified for event ${event.id}`, 'stripe');

        log(`Received webhook: ${event.type} (${event.id})`, 'stripe');

        const result = await handleStripeWebhook(event);
        
        log(`Webhook result: ${result.action} - ${result.reason}`, 'stripe');

        res.status(200).json({ received: true, result });
      } catch (error: any) {
        if (error.type === 'StripeSignatureVerificationError') {
          log(`Webhook signature verification failed: ${error.message}`, 'stripe');
          return res.status(400).json({ error: 'Webhook signature verification failed' });
        }
        log(`Webhook error: ${error.message}`, 'stripe');
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startWorker();
      
      runCleanup();
      setInterval(() => runCleanup(), 10 * 60 * 1000);
      log('Janitor started (cleanup every 10 minutes)', 'cron');
    },
  );
})();
