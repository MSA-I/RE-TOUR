import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Pause, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PipelineToggleProps {
  isEnabled: boolean;
  runState: string;
  isPending?: boolean;
  onToggle: (enabled: boolean, reason?: string) => void;
  compact?: boolean;
}

export function PipelineToggle({
  isEnabled,
  runState,
  isPending = false,
  onToggle,
  compact = false,
}: PipelineToggleProps) {
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      // Opening pause dialog
      setPauseDialogOpen(true);
    } else {
      // Resume immediately
      onToggle(true);
    }
  };

  const confirmPause = () => {
    onToggle(false, pauseReason || undefined);
    setPauseDialogOpen(false);
    setPauseReason("");
  };

  // Determine display state
  const isPaused = !isEnabled || runState === "paused";
  const isCompleted = runState === "completed";
  const isFailed = runState === "failed";
  const isCancelled = runState === "cancelled";

  // Don't show toggle for terminal states
  if (isCompleted || isFailed || isCancelled) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-xs",
          isCompleted && "bg-primary/10 text-primary border-primary/30",
          isFailed && "bg-destructive/10 text-destructive border-destructive/30",
          isCancelled && "bg-muted text-muted-foreground"
        )}
      >
        {isCompleted && "Completed"}
        {isFailed && "Failed"}
        {isCancelled && "Cancelled"}
      </Badge>
    );
  }

  if (compact) {
    return (
      <>
        <div className="flex items-center gap-2">
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
            className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-warning"
          />
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : isPaused ? (
            <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
              <Pause className="w-3 h-3 mr-1" />
              Paused
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              <Play className="w-3 h-3 mr-1" />
              Active
            </Badge>
          )}
        </div>

        <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pause Pipeline</DialogTitle>
              <DialogDescription>
                Pausing will stop new jobs from being created. Currently running jobs will complete.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="pause-reason" className="text-sm font-medium">
                Reason (optional)
              </Label>
              <Textarea
                id="pause-reason"
                placeholder="Why are you pausing this pipeline?"
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                className="mt-2"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPauseDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirmPause} className="bg-warning text-warning-foreground hover:bg-warning/90">
                <Pause className="w-4 h-4 mr-2" />
                Pause Pipeline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50">
        <div className="flex items-center gap-3">
          {isPaused ? (
            <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center">
              <Pause className="w-4 h-4 text-warning" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Play className="w-4 h-4 text-primary" />
            </div>
          )}
          <div>
            <Label className="text-sm font-medium">
              Pipeline {isPaused ? "Paused" : "Active"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {isPaused
                ? "No new jobs will be created"
                : "Jobs will run automatically"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPending && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
            className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-warning"
          />
        </div>
      </div>

      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause Pipeline</DialogTitle>
            <DialogDescription>
              Pausing will stop new jobs from being created. Currently running API calls will complete but no new steps will be triggered.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="pause-reason-full" className="text-sm font-medium">
              Reason (optional)
            </Label>
            <Textarea
              id="pause-reason-full"
              placeholder="Why are you pausing this pipeline?"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPause} className="bg-warning text-warning-foreground hover:bg-warning/90">
              <Pause className="w-4 h-4 mr-2" />
              Pause Pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Filter selector for pipeline list visibility
interface PipelineVisibilityFilterProps {
  value: "all" | "active" | "paused";
  onChange: (value: "all" | "active" | "paused") => void;
}

export function PipelineVisibilityFilter({
  value,
  onChange,
}: PipelineVisibilityFilterProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border/30">
      <Button
        variant={value === "active" ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange("active")}
      >
        <Play className="w-3 h-3 mr-1" />
        Active
      </Button>
      <Button
        variant={value === "paused" ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange("paused")}
      >
        <Pause className="w-3 h-3 mr-1" />
        Paused
      </Button>
      <Button
        variant={value === "all" ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange("all")}
      >
        All
      </Button>
    </div>
  );
}
