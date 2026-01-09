import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { FilterBar } from "@/components/filter-bar";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Eye, ListTodo, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ScheduledTask } from "@shared/schema";

const statusOptions = [
  { value: "all", label: "All Status" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export default function Queue() {
  const { toast } = useToast();
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: tasks = [], isLoading, refetch, isFetching } = useQuery<ScheduledTask[]>({
    queryKey: ["/api/tasks", selectedStatus],
  });

  const retryMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/retry`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task queued for retry" });
      setIsModalOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to retry task", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const response = await apiRequest("DELETE", `/api/tasks/${taskId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task deleted" });
      setIsModalOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to delete task", variant: "destructive" });
    },
  });

  const clearCompletedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/tasks/completed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Completed tasks cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear tasks", variant: "destructive" });
    },
  });

  const handleViewTask = (task: ScheduledTask) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const columns = [
    {
      header: "ID",
      accessorKey: "id",
      cell: (row: ScheduledTask) => (
        <span className="font-mono text-xs">#{row.id}</span>
      ),
    },
    {
      header: "Task Type",
      accessorKey: "taskType",
      cell: (row: ScheduledTask) => (
        <span className="font-medium">{row.taskType}</span>
      ),
    },
    {
      header: "Merchant",
      accessorKey: "merchantId",
      cell: (row: ScheduledTask) => (
        <span className="font-mono text-xs truncate max-w-32 block">
          {row.merchantId}
        </span>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (row: ScheduledTask) => <StatusBadge status={row.status} />,
    },
    {
      header: "Run At",
      accessorKey: "runAt",
      cell: (row: ScheduledTask) => (
        <span className="text-sm text-muted-foreground font-mono">
          {format(new Date(row.runAt), "MMM d, HH:mm:ss")}
        </span>
      ),
    },
    {
      header: "",
      accessorKey: "actions",
      cell: (row: ScheduledTask) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleViewTask(row)}
            data-testid={`button-view-task-${row.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {row.status === "failed" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => retryMutation.mutate(row.id)}
              disabled={retryMutation.isPending}
              data-testid={`button-retry-task-${row.id}`}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Task Queue"
        description="Monitor and manage scheduled recovery tasks"
        actions={
          <div className="flex gap-2">
            {failedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  tasks
                    .filter((t) => t.status === "failed")
                    .forEach((t) => retryMutation.mutate(t.id));
                }}
                data-testid="button-retry-all-failed"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Failed ({failedCount})
              </Button>
            )}
            {completedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearCompletedMutation.mutate()}
                disabled={clearCompletedMutation.isPending}
                data-testid="button-clear-completed"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Completed ({completedCount})
              </Button>
            )}
          </div>
        }
      />

      <FilterBar
        statusOptions={statusOptions}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
      />

      {!isLoading && tasks.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-12 w-12" />}
          title="No tasks in queue"
          description="When recovery tasks are scheduled, they will appear here for monitoring."
        />
      ) : (
        <DataTable
          columns={columns}
          data={tasks}
          isLoading={isLoading}
          emptyMessage="No tasks match your filter"
        />
      )}

      <TaskDetailModal
        task={selectedTask}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onRetry={(id) => retryMutation.mutate(id)}
        onDelete={(id) => deleteMutation.mutate(id)}
      />
    </div>
  );
}
