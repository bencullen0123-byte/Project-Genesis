import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Mail, Activity, Clock } from "lucide-react";

interface MetricsData {
  totalRecoveredCents?: number;
  totalEmailsSent?: number;
  daysTracked?: number;
}

interface UsageData {
  current: number;
  limit: number;
}

interface ActivityLog {
  id: number;
  merchantId: string;
  metricType: string;
  amount: number;
  createdAt: string;
}

interface DashboardStats {
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalMerchants: number;
}

export function MetricsCards({ stats, usage }: { stats: DashboardStats; usage: UsageData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-pending-tasks">{stats.pendingTasks}</div>
          <p className="text-xs text-muted-foreground">Awaiting processing</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Running Tasks</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-running-tasks">{stats.runningTasks}</div>
          <p className="text-xs text-muted-foreground">Currently processing</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Completed</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600" data-testid="text-completed-tasks">{stats.completedTasks}</div>
          <p className="text-xs text-muted-foreground">Successfully processed</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Failed</CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive" data-testid="text-failed-tasks">{stats.failedTasks}</div>
          <p className="text-xs text-muted-foreground">Require attention</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function QueueDepthGauge({ usage }: { usage: UsageData }) {
  const percentage = Math.min((usage.current / usage.limit) * 100, 100);
  const isNearLimit = percentage > 80;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Monthly Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Dunning tasks this month</span>
          <span className={`text-sm font-medium ${isNearLimit ? 'text-destructive' : ''}`} data-testid="text-usage">
            {usage.current.toLocaleString()} / {usage.limit.toLocaleString()}
          </span>
        </div>
        <Progress value={percentage} className={isNearLimit ? '[&>div]:bg-destructive' : ''} />
        <p className="text-xs text-muted-foreground">
          {isNearLimit 
            ? 'You are approaching your monthly limit. Consider upgrading.'
            : `${(usage.limit - usage.current).toLocaleString()} tasks remaining`
          }
        </p>
      </CardContent>
    </Card>
  );
}

export function ActivityFeed({ logs }: { logs: ActivityLog[] }) {
  const getMetricLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'dunning_email_sent': 'Dunning email sent',
      'recovery_success': 'Payment recovered',
      'recovery_failed': 'Recovery failed',
      'task_retry': 'Task retried',
      'merchant_connected': 'Stripe connected',
      'merchant_disconnected': 'Stripe disconnected',
    };
    return labels[type] || type.replace(/_/g, ' ');
  };

  const getMetricBadgeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type.includes('success') || type.includes('connected')) return 'default';
    if (type.includes('failed') || type.includes('disconnected')) return 'destructive';
    return 'secondary';
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-activity">
            No activity yet. Activity will appear here once payment recovery begins.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center justify-between gap-4 text-sm" data-testid={`activity-log-${log.id}`}>
              <div className="flex items-center gap-3">
                <Badge variant={getMetricBadgeVariant(log.metricType)} className="text-xs">
                  {getMetricLabel(log.metricType)}
                </Badge>
                {log.amount > 1 && (
                  <span className="text-muted-foreground">x{log.amount}</span>
                )}
              </div>
              <div className="text-right text-muted-foreground">
                <span className="hidden sm:inline">{formatDate(log.createdAt)} at </span>
                {formatTime(log.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
