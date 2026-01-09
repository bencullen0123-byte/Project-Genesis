import { Badge } from "@/components/ui/badge";
import type { MerchantTierType } from "@shared/schema";

interface TierBadgeProps {
  tier: MerchantTierType | string;
}

const tierConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  FREE: { label: "Free", variant: "secondary" },
  PRO: { label: "Pro", variant: "default" },
  ENTERPRISE: { label: "Enterprise", variant: "outline" },
};

export function TierBadge({ tier }: TierBadgeProps) {
  const config = tierConfig[tier] || { label: tier, variant: "secondary" as const };
  
  return (
    <Badge variant={config.variant} data-testid={`tier-badge-${tier.toLowerCase()}`}>
      {config.label}
    </Badge>
  );
}
