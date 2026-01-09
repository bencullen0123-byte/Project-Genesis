import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  statusOptions: FilterOption[];
  selectedStatus: string;
  onStatusChange: (value: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function FilterBar({
  statusOptions,
  selectedStatus,
  onStatusChange,
  onRefresh,
  isRefreshing,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <Select value={selectedStatus} onValueChange={onStatusChange}>
        <SelectTrigger className="w-40" data-testid="select-status-filter">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {onRefresh && (
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing}
          data-testid="button-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      )}
    </div>
  );
}
