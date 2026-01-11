import { useQuery } from "@tanstack/react-query";
import { ActivationState } from "@/components/empty-state";
import { MetricsCards, QueueDepthGauge, ActivityFeed } from "@/components/dashboard-components";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardData {
  stats: {
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalMerchants: number;
  };
  recentTasks: any[];
  recentActivity: any[];
  usage: {
    current: number;
    limit: number;
  };
  merchant: {
    id: string;
    email: string | null;
    tier: string;
    stripeConnected: boolean;
  };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
    </div>
  );
}

function LiveDashboard({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your payment recovery operations
        </p>
      </div>
      
      <MetricsCards stats={data.stats} usage={data.usage} />
      
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueDepthGauge usage={data.usage} />
        <ActivityFeed logs={data.recentActivity} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['/api/dashboard'],
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive">Error loading dashboard</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  if (!data.merchant.stripeConnected) {
    return <ActivationState />;
  }

  return <LiveDashboard data={data} />;
}
