import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Image,
} from "lucide-react";
import type { CameraAnchorStatus } from "@/hooks/useCameraAnchor";
import type { CameraScanItem } from "@/hooks/useCameraScanItems";

interface MarkerWithAnchor {
  id: string;
  label: string;
  anchor_status?: CameraAnchorStatus;
  anchor_error_message?: string | null;
}

interface CameraAnchorGateProps {
  markers: MarkerWithAnchor[];
  onCreateAllAnchors: () => void;
  isCreatingAll: boolean;
  className?: string;
  /** Optional: Check scan crops too */
  getItemForMarker?: (markerId: string) => CameraScanItem | undefined;
}

export const CameraAnchorGate = memo(function CameraAnchorGate({
  markers,
  onCreateAllAnchors,
  isCreatingAll,
  className,
  getItemForMarker,
}: CameraAnchorGateProps) {
  if (markers.length === 0) {
    return null;
  }

  // Calculate status counts
  const counts = {
    not_created: 0,
    generating: 0,
    ready: 0,
    failed: 0,
    outdated: 0,
  };

  const needsAction: MarkerWithAnchor[] = [];
  const missingCrops: MarkerWithAnchor[] = [];
  let totalCrops = 0;

  for (const m of markers) {
    const status = (m.anchor_status || "not_created") as CameraAnchorStatus;
    counts[status]++;
    
    if (status !== "ready" && status !== "generating") {
      needsAction.push(m);
    }
    
    // Check for scan crop if function provided
    if (getItemForMarker) {
      const scanItem = getItemForMarker(m.id);
      if (scanItem?.crop_public_url) {
        totalCrops++;
      } else if (status === "ready") {
        // Anchor ready but no crop - might need scan
        missingCrops.push(m);
      }
    }
  }

  const total = markers.length;
  const ready = counts.ready;
  const allReady = ready === total && total > 0;
  const hasGenerating = counts.generating > 0;
  const progressPercent = total > 0 ? (ready / total) * 100 : 0;

  // All ready - show success state
  if (allReady) {
    return (
      <Alert className={cn("border-status-approved/50 bg-status-approved/5", className)}>
        <CheckCircle2 className="h-4 w-4 text-status-approved" />
        <AlertTitle className="text-status-approved">
          All Camera Anchors Ready
        </AlertTitle>
        <AlertDescription className="text-sm text-muted-foreground">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{total} camera anchor{total !== 1 ? "s" : ""} confirmed.</span>
            {getItemForMarker && (
              <Badge variant="outline" className="text-xs gap-1">
                <Image className="h-3 w-3" />
                {totalCrops}/{total} crops
              </Badge>
            )}
          </div>
          {missingCrops.length > 0 && (
            <p className="text-xs text-status-running mt-1">
              Note: {missingCrops.length} marker(s) missing scan crops - run AI Scan to generate
            </p>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Currently generating
  if (hasGenerating && !isCreatingAll) {
    return (
      <Alert className={cn("border-primary/50 bg-primary/5", className)}>
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
        <AlertTitle className="text-primary">
          Generating Anchors...
        </AlertTitle>
        <AlertDescription className="text-sm space-y-2">
          <p className="text-muted-foreground">
            {counts.generating} anchor{counts.generating !== 1 ? "s" : ""} in progress
          </p>
          <Progress value={progressPercent} className="h-1" />
        </AlertDescription>
      </Alert>
    );
  }

  // Needs action - show gate
  return (
    <Alert 
      variant="destructive" 
      className={cn(
        "border-status-running/50 bg-status-running/5",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-status-running" />
      <AlertTitle className="text-status-running">
        Camera Anchors Required
      </AlertTitle>
      <AlertDescription className="text-sm space-y-3">
        <p className="text-muted-foreground">
          {needsAction.length} camera{needsAction.length !== 1 ? "s" : ""} need anchor screenshots before renders can start.
        </p>

        <div className="flex flex-wrap gap-1">
          {needsAction.slice(0, 5).map((m) => (
            <Badge 
              key={m.id} 
              variant="outline" 
              className={cn(
                "text-xs",
                m.anchor_status === "failed" && "border-destructive text-destructive",
                m.anchor_status === "outdated" && "border-status-running text-status-running"
              )}
            >
              {m.label}
              {m.anchor_status === "failed" && " (failed)"}
              {m.anchor_status === "outdated" && " (outdated)"}
            </Badge>
          ))}
          {needsAction.length > 5 && (
            <Badge variant="secondary" className="text-xs">
              +{needsAction.length - 5} more
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Progress value={progressPercent} className="h-1 flex-1" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {ready}/{total} ready
          </span>
        </div>

        <Button
          size="sm"
          onClick={onCreateAllAnchors}
          disabled={isCreatingAll}
          className="w-full"
        >
          {isCreatingAll ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Anchors...
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Create All Missing Anchors ({needsAction.length})
            </>
          )}
        </Button>
      </AlertDescription>
    </Alert>
  );
});
