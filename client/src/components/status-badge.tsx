import { Badge } from "@/components/ui/badge";
import type { TaskStatusType } from "@shared/schema";

interface StatusBadgeProps {
  status: TaskStatusType | string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: "secondary" as const };
  
  return (
    <Badge variant={config.variant} data-testid={`status-badge-${status}`}>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${
          status === "pending" ? "bg-status-away" :
          status === "running" ? "bg-status-online animate-pulse" :
          status === "completed" ? "bg-status-online" :
          status === "failed" ? "bg-status-busy" : "bg-status-offline"
        }`} />
        {config.label}
      </span>
    </Badge>
  );
}
