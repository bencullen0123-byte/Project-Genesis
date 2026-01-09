import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "./status-badge";
import { RefreshCw, Trash2 } from "lucide-react";
import type { ScheduledTask } from "@shared/schema";
import { format } from "date-fns";

interface TaskDetailModalProps {
  task: ScheduledTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: (taskId: number) => void;
  onDelete?: (taskId: number) => void;
}

export function TaskDetailModal({ 
  task, 
  open, 
  onOpenChange,
  onRetry,
  onDelete 
}: TaskDetailModalProps) {
  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Task #{task.id}
            <StatusBadge status={task.status} />
          </DialogTitle>
          <DialogDescription>
            {task.taskType} - Created {format(new Date(task.createdAt), "PPpp")}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Merchant ID</span>
              <p className="font-mono text-xs mt-1">{task.merchantId}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Run At</span>
              <p className="font-mono text-xs mt-1">
                {format(new Date(task.runAt), "PPpp")}
              </p>
            </div>
          </div>

          <div>
            <span className="text-sm text-muted-foreground">Payload</span>
            <ScrollArea className="h-48 mt-2 rounded-md border bg-muted/30 p-4">
              <pre className="font-mono text-xs">
                {JSON.stringify(task.payload, null, 2)}
              </pre>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          {task.status === "failed" && onRetry && (
            <Button 
              variant="secondary" 
              onClick={() => onRetry(task.id)}
              data-testid="button-retry-task"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Task
            </Button>
          )}
          {onDelete && (
            <Button 
              variant="destructive" 
              onClick={() => onDelete(task.id)}
              data-testid="button-delete-task"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
