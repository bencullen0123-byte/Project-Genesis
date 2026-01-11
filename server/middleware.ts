import { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { log } from './index';
import { PLANS } from '@shared/plans';
import type { Merchant } from '@shared/schema';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string | null;
        sessionId: string | null;
        claims?: {
          email?: string;
          primaryEmailAddress?: string;
        };
      };
      merchant?: Merchant;
    }
  }
}

export async function requireMerchant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clerkUserId = req.auth?.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  try {
    let merchant = await storage.getMerchantByClerkUserId(clerkUserId);

    if (!merchant) {
      const email = req.auth?.claims?.email || req.auth?.claims?.primaryEmailAddress || null;
      
      log(`Auto-provisioning merchant for Clerk user ${clerkUserId}`, 'auth');
      
      merchant = await storage.createMerchant({
        clerkUserId,
        email,
        tier: 'FREE',
        subscriptionPlanId: 'price_free',
      });

      log(`Merchant ${merchant.id} created for Clerk user ${clerkUserId}`, 'auth');
    }

    req.merchant = merchant;
    next();
  } catch (error: any) {
    log(`Merchant lookup/creation failed for Clerk user ${clerkUserId}: ${error.message}`, 'auth', 'error');
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process authentication' });
  }
}

export async function checkUsageLimits(
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  const merchant = req.merchant;
  
  if (!merchant) {
    next();
    return;
  }

  try {
    const plan = PLANS[merchant.subscriptionPlanId || ''] || PLANS['default'];
    const limit = plan.limit;

    const monthlyCount = await storage.getMonthlyDunningCount(merchant.id);
    
    if (monthlyCount >= limit) {
      log(`Usage limit exceeded for merchant ${merchant.id}: ${monthlyCount}/${limit} (${plan.name} plan)`, 'middleware');
      res.status(402).json({ 
        error: 'Payment Required',
        message: `Monthly limit of ${limit} exceeded. Please upgrade your plan.`,
        usage: {
          current: monthlyCount,
          limit: limit,
          plan: plan.name
        }
      });
      return;
    }
    
    next();
  } catch (error: any) {
    log(`Usage check error for merchant ${merchant.id}: ${error.message}`, 'middleware');
    next();
  }
}
