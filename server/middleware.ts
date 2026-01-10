import { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { log } from './index';

const MONTHLY_LIMIT = 1000;

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
    const monthlyCount = await storage.getMonthlyDunningCount(merchantId);
    
    if (monthlyCount >= MONTHLY_LIMIT) {
      log(`Usage limit exceeded for merchant ${merchantId}: ${monthlyCount}/${MONTHLY_LIMIT}`, 'middleware');
      res.status(402).json({ 
        error: 'Payment Required',
        message: 'Monthly limit exceeded. Please upgrade your plan.',
        usage: {
          current: monthlyCount,
          limit: MONTHLY_LIMIT
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
