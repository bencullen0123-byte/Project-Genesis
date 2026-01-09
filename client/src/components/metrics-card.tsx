import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export function MetricsCard({ title, value, subtitle, trend, icon, isLoading }: MetricsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-5 rounded" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-1" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  const TrendIcon = trend !== undefined 
    ? trend > 0 
      ? TrendingUp 
      : trend < 0 
        ? TrendingDown 
        : Minus
    : null;

  const trendColor = trend !== undefined
    ? trend > 0 
      ? "text-status-online" 
      : trend < 0 
        ? "text-status-busy" 
        : "text-muted-foreground"
    : "";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {(subtitle || trend !== undefined) && (
          <div className="flex items-center gap-1 mt-1">
            {TrendIcon && <TrendIcon className={`h-3 w-3 ${trendColor}`} />}
            {trend !== undefined && (
              <span className={`text-xs ${trendColor}`}>
                {trend > 0 ? "+" : ""}{trend}%
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
