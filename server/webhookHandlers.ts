import Stripe from 'stripe';
import { storage } from './storage';
import { getStripeClientFactory } from './stripeClient';
import { TaskStatus } from '@shared/schema';

export interface WebhookResult {
  processed: boolean;
  action: 'ignored' | 'enqueued' | 'error' | 'processed';
  reason: string;
  taskId?: number;
}

export async function handleStripeWebhook(event: Stripe.Event): Promise<WebhookResult> {
  const eventId = event.id;

  // 1. ATOMIC LOCK (The Fix)
  // Try to insert. If it exists, this returns false immediately.
  const isFirstProcessing = await storage.attemptEventLock(eventId);

  if (!isFirstProcessing) {
    return {
      processed: false,
      action: 'ignored',
      reason: `Event ${eventId} handled by parallel worker (idempotency lock)`,
    };
  }

  // 2. Process (No need to mark processed again - we already locked it)
  switch (event.type) {
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event);
    
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
      return handleSubscriptionUpdated(event);
    
    case 'invoice.payment_action_required':
      return handlePaymentActionRequired(event);
    
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);
    
    case 'charge.failed':
      return handleChargeFailed(event);

    default:
      return {
        processed: true,
        action: 'ignored',
        reason: `Event type ${event.type} not handled`,
      };
  }
}

async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<WebhookResult> {
  const invoice = event.data.object as Stripe.Invoice;
  const billingReason = invoice.billing_reason;

  if (billingReason === 'subscription_create') {
    return {
      processed: true,
      action: 'ignored',
      reason: 'Onboarding failure (subscription_create) - not a churn recovery target',
    };
  }

  if (billingReason === 'subscription_cycle') {
    return enqueueDunningTask(event, invoice);
  }

  if (billingReason === 'subscription_update') {
    return {
      processed: true,
      action: 'ignored',
      reason: 'Subscription update failure - manual intervention may be needed',
    };
  }

  if (billingReason === 'manual') {
    return {
      processed: true,
      action: 'ignored', 
      reason: 'Manual invoice failure - not automated recovery target',
    };
  }

  return {
    processed: true,
    action: 'ignored',
    reason: `Unhandled billing_reason: ${billingReason}`,
  };
}

async function enqueueDunningTask(event: Stripe.Event, invoice: Stripe.Invoice): Promise<WebhookResult> {
  try {
    const stripeConnectId = event.account;
    
    if (!stripeConnectId) {
      return {
        processed: true,
        action: 'error',
        reason: 'No Stripe Connect account ID in event - cannot determine tenant',
      };
    }

    const factory = await getStripeClientFactory();
    let merchantId: string;

    try {
      const result = await factory.getClientByConnectId(stripeConnectId);
      merchantId = result.merchantId;
    } catch (err) {
      return {
        processed: true,
        action: 'error',
        reason: `Unknown merchant for Connect ID ${stripeConnectId}`,
      };
    }

    const retryDelay = calculateRetryDelay(invoice);
    const runAt = new Date(Date.now() + retryDelay);

    const subscriptionId = invoice.parent?.subscription_details?.subscription;
    const task = await storage.createTask({
      merchantId,
      taskType: 'dunning_retry',
      payload: {
        eventId: event.id,
        invoiceId: invoice.id,
        customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
        subscriptionId: typeof subscriptionId === 'string' ? subscriptionId : (subscriptionId as any)?.id || null,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        attemptCount: invoice.attempt_count || 1,
        billingReason: invoice.billing_reason,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      },
      status: TaskStatus.PENDING,
      runAt,
    });

    await storage.createUsageLog({
      merchantId,
      metricType: 'task_scheduled',
      amount: 1,
    });

    return {
      processed: true,
      action: 'enqueued',
      reason: `Dunning task scheduled for invoice ${invoice.id} at ${runAt.toISOString()}`,
      taskId: task.id,
    };
  } catch (error: any) {
    return {
      processed: false,
      action: 'error',
      reason: `Failed to enqueue dunning task: ${error.message}`,
    };
  }
}

function calculateRetryDelay(invoice: Stripe.Invoice): number {
  const attemptCount = invoice.attempt_count || 1;
  
  const delays: Record<number, number> = {
    1: 3 * 24 * 60 * 60 * 1000,
    2: 5 * 24 * 60 * 60 * 1000,
    3: 7 * 24 * 60 * 60 * 1000,
  };

  return delays[attemptCount] || 7 * 24 * 60 * 60 * 1000;
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<WebhookResult> {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeConnectId = event.account;

  if (!stripeConnectId) {
    return {
      processed: true,
      action: 'ignored',
      reason: 'No Stripe Connect account ID - cannot log churn',
    };
  }

  try {
    const factory = await getStripeClientFactory();
    const { merchantId } = await factory.getClientByConnectId(stripeConnectId);

    await storage.createUsageLog({
      merchantId,
      metricType: 'subscription_churned',
      amount: 1,
    });

    return {
      processed: true,
      action: 'ignored',
      reason: `Subscription ${subscription.id} churned - logged for analytics`,
    };
  } catch (err: any) {
    return {
      processed: true,
      action: 'error',
      reason: `Failed to log subscription churn: ${err.message}`,
    };
  }
}

async function handleChargeFailed(event: Stripe.Event): Promise<WebhookResult> {
  return {
    processed: true,
    action: 'ignored',
    reason: 'Charge failures handled via invoice.payment_failed',
  };
}

async function handlePaymentActionRequired(event: Stripe.Event): Promise<WebhookResult> {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeConnectId = event.account;

  if (!stripeConnectId) {
    return {
      processed: true,
      action: 'error',
      reason: 'No Stripe Connect account ID in event - cannot determine tenant',
    };
  }

  try {
    const factory = await getStripeClientFactory();
    let merchantId: string;

    try {
      const result = await factory.getClientByConnectId(stripeConnectId);
      merchantId = result.merchantId;
    } catch (err) {
      return {
        processed: true,
        action: 'error',
        reason: `Unknown merchant for Connect ID ${stripeConnectId}`,
      };
    }

    const subscriptionId = invoice.parent?.subscription_details?.subscription;
    const task = await storage.createTask({
      merchantId,
      taskType: 'notify_action_required',
      payload: {
        eventId: event.id,
        invoiceId: invoice.id,
        customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
        subscriptionId: typeof subscriptionId === 'string' ? subscriptionId : (subscriptionId as any)?.id || null,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      },
      status: TaskStatus.PENDING,
      runAt: new Date(),
    });

    await storage.createUsageLog({
      merchantId,
      metricType: 'action_required_notification',
      amount: 1,
    });

    return {
      processed: true,
      action: 'enqueued',
      reason: `Action required notification task created for invoice ${invoice.id}`,
      taskId: task.id,
    };
  } catch (error: any) {
    return {
      processed: false,
      action: 'error',
      reason: `Failed to create action required task: ${error.message}`,
    };
  }
}

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<WebhookResult> {
  // TRUST BOUNDARY CHECK (Security Fix)
  // SaaS Plans (Free/Pro) are sold by US (The Platform).
  // If event.account is present, this event came from a User's Connected Account.
  // We MUST ignore these for billing purposes to prevent the "Free Pro" exploit.
  if (event.account) {
    return { 
      processed: true, 
      action: 'ignored', 
      reason: 'Security Guard: Ignoring tenant-side subscription event' 
    };
  }

  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;
  const status = subscription.status;

  if (!priceId) {
    return { 
      processed: true, 
      action: 'ignored', 
      reason: 'No price ID found in subscription items' 
    };
  }

  try {
    // Find merchant by Platform Customer ID
    const merchant = await storage.getMerchantByStripeCustomerId(stripeCustomerId);

    if (!merchant) {
      return { 
        processed: true, 
        action: 'error', 
        reason: `Merchant not found for Customer ID: ${stripeCustomerId}` 
      };
    }

    // If active/trialing -> Set Plan ID. Otherwise -> Free.
    const newPlanId = (status === 'active' || status === 'trialing') ? priceId : 'price_free';

    await storage.updateMerchant(merchant.id, {
      subscriptionPlanId: newPlanId
    });

    return { 
      processed: true, 
      action: 'processed', 
      reason: `Plan updated to ${newPlanId} for merchant ${merchant.id}` 
    };

  } catch (err: any) {
    return { 
      processed: false, 
      action: 'error', 
      reason: `Failed to sync plan: ${err.message}` 
    };
  }
}
