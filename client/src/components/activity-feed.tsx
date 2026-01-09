import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { UsageLog } from "@shared/schema";

interface ActivityFeedProps {
  activities: UsageLog[];
  isLoading?: boolean;
}

const activityIcons: Record<string, React.ReactNode> = {
  recovery_success: <CheckCircle2 className="h-4 w-4 text-status-online" />,
  recovery_failed: <XCircle className="h-4 w-4 text-status-busy" />,
  task_scheduled: <Clock className="h-4 w-4 text-status-away" />,
  task_retry: <RefreshCw className="h-4 w-4 text-muted-foreground" />,
};

const activityLabels: Record<string, string> = {
  recovery_success: "Payment Recovered",
  recovery_failed: "Recovery Failed",
  task_scheduled: "Task Scheduled",
  task_retry: "Task Retried",
};

export function ActivityFeed({ activities, isLoading }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-4 w-4 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64">
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No recent activity
            </p>
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {activityIcons[activity.metricType] || <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {activityLabels[activity.metricType] || activity.metricType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {activity.amount > 1 && (
                    <span className="text-xs font-medium bg-muted rounded-full px-2 py-0.5">
                      x{activity.amount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
