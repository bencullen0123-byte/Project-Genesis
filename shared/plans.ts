export interface PlanConfig {
  name: string;
  limit: number;
  queueLimit: number;
}

export const PLANS: Record<string, PlanConfig> = {
  'price_free': { 
    name: 'Hobby', 
    limit: 20,
    queueLimit: 5
  },
  'price_growth': {
    name: 'Growth', 
    limit: 1000, 
    queueLimit: 100 
  },
  'price_pro': { 
    name: 'Pro', 
    limit: 10000, 
    queueLimit: 1000
  },
  'default': { 
    name: 'Basic', 
    limit: 20, 
    queueLimit: 5 
  }
};
