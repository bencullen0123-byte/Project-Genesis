import { Progress } from "@/components/ui/progress";

interface QueueDepthGaugeProps {
  current: number;
  max: number;
  label?: string;
}

export function QueueDepthGauge({ current, max, label = "Queue Depth" }: QueueDepthGaugeProps) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  
  const getColor = () => {
    if (percentage < 50) return "bg-status-online";
    if (percentage < 80) return "bg-status-away";
    return "bg-status-busy";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-sm font-mono text-foreground">
          {current} / {max}
        </span>
      </div>
      <div className="relative">
        <Progress value={percentage} className="h-2" />
        <div 
          className={`absolute inset-0 h-2 rounded-full transition-all ${getColor()}`} 
          style={{ width: `${percentage}%` }} 
        />
      </div>
    </div>
  );
}
