export interface PlanConfig {
  name: string;
  limit: number;
}

export const PLANS: Record<string, PlanConfig> = {
  'price_free': { name: 'Free', limit: 1000 },
  'price_pro': { name: 'Pro', limit: 10000 },
  'default': { name: 'Basic', limit: 500 }
};
