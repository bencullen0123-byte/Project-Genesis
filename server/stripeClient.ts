import Stripe from 'stripe';
import { db } from './db';
import { merchants } from '@shared/schema';
import { eq } from 'drizzle-orm';

let cachedCredentials: { publishableKey: string; secretKey: string } | null = null;

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  const data = await response.json();
  const connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  cachedCredentials = {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };

  return cachedCredentials;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export class StripeClientFactory {
  private platformClient: Stripe | null = null;
  private tenantClients: Map<string, Stripe> = new Map();
  private secretKey: string | null = null;

  async initialize(): Promise<void> {
    this.secretKey = await getStripeSecretKey();
    this.platformClient = new Stripe(this.secretKey, {
      apiVersion: '2025-11-17.clover',
    });
  }

  getPlatformClient(): Stripe {
    if (!this.platformClient) {
      throw new Error('StripeClientFactory not initialized. Call initialize() first.');
    }
    return this.platformClient;
  }

  async getClient(tenantId: string): Promise<Stripe> {
    if (!this.secretKey) {
      throw new Error('StripeClientFactory not initialized. Call initialize() first.');
    }

    if (this.tenantClients.has(tenantId)) {
      return this.tenantClients.get(tenantId)!;
    }

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, tenantId));
    
    if (!merchant) {
      throw new Error(`Merchant not found: ${tenantId}`);
    }

    if (!merchant.stripeConnectId) {
      throw new Error(`Merchant ${tenantId} has no Stripe Connect ID configured`);
    }

    const tenantClient = new Stripe(this.secretKey, {
      apiVersion: '2025-11-17.clover',
      stripeAccount: merchant.stripeConnectId,
    });

    this.tenantClients.set(tenantId, tenantClient);
    return tenantClient;
  }

  async getClientByConnectId(stripeConnectId: string): Promise<{ client: Stripe; merchantId: string }> {
    if (!this.secretKey) {
      throw new Error('StripeClientFactory not initialized. Call initialize() first.');
    }

    const [merchant] = await db.select().from(merchants).where(eq(merchants.stripeConnectId, stripeConnectId));
    
    if (!merchant) {
      throw new Error(`No merchant found for Stripe Connect ID: ${stripeConnectId}`);
    }

    const client = await this.getClient(merchant.id);
    return { client, merchantId: merchant.id };
  }

  clearCache(tenantId?: string): void {
    if (tenantId) {
      this.tenantClients.delete(tenantId);
    } else {
      this.tenantClients.clear();
    }
  }
}

let factoryInstance: StripeClientFactory | null = null;

export async function getStripeClientFactory(): Promise<StripeClientFactory> {
  if (!factoryInstance) {
    factoryInstance = new StripeClientFactory();
    await factoryInstance.initialize();
  }
  return factoryInstance;
}
