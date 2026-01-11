import { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { log } from './index';
import { PLANS } from '@shared/plans';

export async function checkUsageLimits(
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  const merchantId = req.query.merchantId as string | undefined;
  
  if (!merchantId) {
    next();
    return;
  }

  try {
    const merchant = await storage.getMerchant(merchantId);
    
    if (!merchant) {
      next();
      return;
    }

    const plan = PLANS[merchant.subscriptionPlanId || ''] || PLANS['default'];
    const limit = plan.limit;

    const monthlyCount = await storage.getMonthlyDunningCount(merchantId);
    
    if (monthlyCount >= limit) {
      log(`Usage limit exceeded for merchant ${merchantId}: ${monthlyCount}/${limit} (${plan.name} plan)`, 'middleware');
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
    log(`Usage check error for merchant ${merchantId}: ${error.message}`, 'middleware');
    next();
  }
}
