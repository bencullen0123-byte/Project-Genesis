import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueueDepthGauge } from "./queue-depth-gauge";
import { format } from "date-fns";

interface SystemHealthCardProps {
  pendingTasks: number;
  runningTasks: number;
  maxQueueSize: number;
  lastProcessedAt?: string | null;
  processingRate?: number;
  isLoading?: boolean;
}

export function SystemHealthCard({
  pendingTasks,
  runningTasks,
  maxQueueSize,
  lastProcessedAt,
  processingRate = 0,
  isLoading,
}: SystemHealthCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  const isHealthy = pendingTasks < maxQueueSize * 0.8;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">System Health</CardTitle>
        <Badge variant={isHealthy ? "outline" : "destructive"}>
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? "bg-status-online" : "bg-status-busy"}`} />
            {isHealthy ? "Healthy" : "Degraded"}
          </span>
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <QueueDepthGauge 
          current={pendingTasks} 
          max={maxQueueSize} 
          label="Pending Tasks"
        />
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Running</span>
            <p className="text-lg font-semibold">{runningTasks}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Rate/min</span>
            <p className="text-lg font-semibold">{processingRate}</p>
          </div>
        </div>

        {lastProcessedAt && (
          <div className="pt-2 border-t">
            <span className="text-xs text-muted-foreground">Last Processed</span>
            <p className="font-mono text-xs mt-1">
              {format(new Date(lastProcessedAt), "PPpp")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
