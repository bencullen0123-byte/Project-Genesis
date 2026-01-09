import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { getStripeClientFactory, getStripeSecretKey } from './stripeClient';
import { handleStripeWebhook } from './webhookHandlers';
import Stripe from 'stripe';

const app = express();
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

let webhookSecret: string | null = null;

async function initStripe() {
  try {
    log('Initializing Stripe client factory...', 'stripe');
    const factory = await getStripeClientFactory();
    log('Stripe client factory ready', 'stripe');

    const platformClient = factory.getPlatformClient();
    
    log('Setting up webhook endpoint...', 'stripe');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookUrl = `${webhookBaseUrl}/api/stripe/webhook`;
    
    try {
      const existingWebhooks = await platformClient.webhookEndpoints.list({ limit: 100 });
      const existingWebhook = existingWebhooks.data.find(wh => wh.url === webhookUrl);
      
      if (existingWebhook) {
        log(`Using existing webhook: ${existingWebhook.id}`, 'stripe');
        webhookSecret = existingWebhook.secret || null;
      } else {
        const newWebhook = await platformClient.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: [
            'invoice.payment_failed',
            'invoice.payment_succeeded',
            'customer.subscription.deleted',
            'charge.failed',
          ],
        });
        webhookSecret = newWebhook.secret || null;
        log(`Created webhook: ${newWebhook.id}`, 'stripe');
      }
    } catch (webhookError: any) {
      log(`Webhook setup skipped: ${webhookError.message}`, 'stripe');
    }
  } catch (error: any) {
    log(`Failed to initialize Stripe: ${error.message}`, 'stripe');
  }
}

(async () => {
  await initStripe();

  app.post(
    '/api/stripe/webhook',
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

        const secretKey = await getStripeSecretKey();
        const stripe = new Stripe(secretKey, { apiVersion: '2025-11-17.clover' });

        let event: Stripe.Event;

        if (webhookSecret) {
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } else {
          event = JSON.parse(req.body.toString()) as Stripe.Event;
          log('Warning: Processing webhook without signature verification', 'stripe');
        }

        log(`Received webhook: ${event.type} (${event.id})`, 'stripe');

        const result = await handleStripeWebhook(event);
        
        log(`Webhook result: ${result.action} - ${result.reason}`, 'stripe');

        res.status(200).json({ received: true, result });
      } catch (error: any) {
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
    },
  );
})();
