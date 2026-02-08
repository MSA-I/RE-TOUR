import { memo } from "react";
import { Check, Clock, Loader2, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type SpaceStageStatus = "pending" | "running" | "review" | "approved" | "failed";

interface SpaceStatusIndicatorProps {
  label: string;
  status: SpaceStageStatus;
  compact?: boolean;
}

const STATUS_CONFIG: Record<SpaceStageStatus, { icon: React.ElementType; className: string; label: string }> = {
  pending: { icon: Minus, className: "text-muted-foreground", label: "—" },
  running: { icon: Loader2, className: "text-blue-400 animate-spin", label: "⏳" },
  review: { icon: Clock, className: "text-yellow-400", label: "⏳" },
  approved: { icon: Check, className: "text-green-400", label: "✓" },
  failed: { icon: X, className: "text-destructive", label: "✗" },
};

export const SpaceStatusIndicator = memo(function SpaceStatusIndicator({
  label,
  status,
  compact = false,
}: SpaceStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={cn("w-3.5 h-3.5", config.className)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg bg-muted/30">
      <Icon className={cn("w-4 h-4", config.className)} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
});
