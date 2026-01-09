import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { format } from "date-fns";
import type { UsageLog } from "@shared/schema";

const metricOptions = [
  { value: "all", label: "All Types" },
  { value: "recovery_success", label: "Recovery Success" },
  { value: "recovery_failed", label: "Recovery Failed" },
  { value: "task_scheduled", label: "Task Scheduled" },
  { value: "task_retry", label: "Task Retry" },
];

const metricLabels: Record<string, string> = {
  recovery_success: "Recovery Success",
  recovery_failed: "Recovery Failed",
  task_scheduled: "Task Scheduled",
  task_retry: "Task Retry",
};

const metricVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  recovery_success: "default",
  recovery_failed: "destructive",
  task_scheduled: "secondary",
  task_retry: "outline",
};

export default function ActivityPage() {
  const [selectedMetric, setSelectedMetric] = useState("all");

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery<UsageLog[]>({
    queryKey: ["/api/activity", selectedMetric],
  });

  const columns = [
    {
      header: "Timestamp",
      accessorKey: "createdAt",
      cell: (row: UsageLog) => (
        <span className="font-mono text-xs">
          {format(new Date(row.createdAt), "MMM d, HH:mm:ss")}
        </span>
      ),
    },
    {
      header: "Type",
      accessorKey: "metricType",
      cell: (row: UsageLog) => (
        <Badge variant={metricVariants[row.metricType] || "secondary"}>
          {metricLabels[row.metricType] || row.metricType}
        </Badge>
      ),
    },
    {
      header: "Merchant",
      accessorKey: "merchantId",
      cell: (row: UsageLog) => (
        <span className="font-mono text-xs truncate max-w-32 block">
          {row.merchantId}
        </span>
      ),
    },
    {
      header: "Amount",
      accessorKey: "amount",
      cell: (row: UsageLog) => (
        <span className="text-sm font-medium">{row.amount}</span>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Activity Log"
        description="Track all recovery operations and system events"
      />

      <FilterBar
        statusOptions={metricOptions}
        selectedStatus={selectedMetric}
        onStatusChange={setSelectedMetric}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
      />

      {!isLoading && logs.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-12 w-12" />}
          title="No activity yet"
          description="System events and recovery operations will be logged here."
        />
      ) : (
        <DataTable
          columns={columns}
          data={logs}
          isLoading={isLoading}
          emptyMessage="No activity matches your filter"
        />
      )}
    </div>
  );
}
