import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { MetricsCard } from "@/components/metrics-card";
import { SystemHealthCard } from "@/components/system-health-card";
import { ActivityFeed } from "@/components/activity-feed";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Users, ListTodo, TrendingUp, Eye } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import type { ScheduledTask, UsageLog, Merchant, DailyMetric } from "@shared/schema";

interface DashboardStats {
  totalRecovered: number;
  activeMerchants: number;
  pendingTasks: number;
  runningTasks: number;
  successRate: number;
  processingRate: number;
  lastProcessedAt: string | null;
  trends: {
    recovered: number;
    merchants: number;
    tasks: number;
  };
}

interface DashboardData {
  stats: DashboardStats;
  recentTasks: ScheduledTask[];
  recentActivity: UsageLog[];
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });

  const stats = data?.stats;
  const recentTasks = data?.recentTasks || [];
  const recentActivity = data?.recentActivity || [];

  const taskColumns = [
    {
      header: "ID",
      accessorKey: "id",
      cell: (row: ScheduledTask) => (
        <span className="font-mono text-xs">#{row.id}</span>
      ),
    },
    {
      header: "Type",
      accessorKey: "taskType",
      cell: (row: ScheduledTask) => (
        <span className="font-medium">{row.taskType}</span>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (row: ScheduledTask) => <StatusBadge status={row.status} />,
    },
    {
      header: "Scheduled",
      accessorKey: "runAt",
      cell: (row: ScheduledTask) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.runAt), "MMM d, HH:mm")}
        </span>
      ),
    },
    {
      header: "",
      accessorKey: "actions",
      cell: (row: ScheduledTask) => (
        <Link href={`/queue?task=${row.id}`}>
          <Button variant="ghost" size="icon" data-testid={`button-view-task-${row.id}`}>
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Dashboard"
        description="Overview of your Stripe recovery operations"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricsCard
          title="Total Recovered"
          value={stats ? `$${(stats.totalRecovered / 100).toLocaleString()}` : "$0"}
          trend={stats?.trends.recovered}
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricsCard
          title="Active Merchants"
          value={stats?.activeMerchants || 0}
          trend={stats?.trends.merchants}
          icon={<Users className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricsCard
          title="Pending Tasks"
          value={stats?.pendingTasks || 0}
          trend={stats?.trends.tasks}
          icon={<ListTodo className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricsCard
          title="Success Rate"
          value={stats ? `${stats.successRate}%` : "0%"}
          subtitle="last 7 days"
          icon={<TrendingUp className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Tasks</h2>
            <Link href="/queue">
              <Button variant="outline" size="sm" data-testid="link-view-all-tasks">
                View All
              </Button>
            </Link>
          </div>
          <DataTable
            columns={taskColumns}
            data={recentTasks}
            isLoading={isLoading}
            emptyMessage="No tasks scheduled yet"
          />
        </div>
        <div>
          <SystemHealthCard
            pendingTasks={stats?.pendingTasks || 0}
            runningTasks={stats?.runningTasks || 0}
            maxQueueSize={1000}
            lastProcessedAt={stats?.lastProcessedAt}
            processingRate={stats?.processingRate || 0}
            isLoading={isLoading}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityFeed activities={recentActivity} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
