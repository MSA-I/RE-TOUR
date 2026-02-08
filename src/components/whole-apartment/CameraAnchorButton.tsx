import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Camera,
  AlertTriangle,
  Image,
  RotateCcw,
} from "lucide-react";
import type { CameraAnchorStatus } from "@/hooks/useCameraAnchor";

interface CameraAnchorButtonProps {
  markerId: string;
  markerLabel: string;
  anchorStatus: CameraAnchorStatus | undefined;
  anchorErrorMessage: string | null | undefined;
  onCreateAnchor: (markerId: string) => void;
  onResetCrop?: (markerId: string) => void;
  isCreating: boolean;
  isResetting?: boolean;
  disabled?: boolean;
  variant?: "inline" | "compact";
  /** Optional crop thumbnail URL from scan */
  cropThumbnailUrl?: string | null;
  /** Whether this marker has a scan crop asset */
  hasScanCrop?: boolean;
}

export const CameraAnchorButton = memo(function CameraAnchorButton({
  markerId,
  markerLabel,
  anchorStatus,
  anchorErrorMessage,
  onCreateAnchor,
  onResetCrop,
  isCreating,
  isResetting,
  disabled,
  variant = "inline",
  cropThumbnailUrl,
  hasScanCrop,
}: CameraAnchorButtonProps) {
  const status = anchorStatus || "not_created";
  
  // Status display configuration
  const statusConfig: Record<CameraAnchorStatus, {
    icon: React.ReactNode;
    label: string;
    color: string;
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
  }> = {
    not_created: {
      icon: <Camera className="w-3 h-3" />,
      label: "Create Anchor",
      color: "text-muted-foreground",
      badgeVariant: "outline",
    },
    generating: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: "Generating...",
      color: "text-blue-500",
      badgeVariant: "secondary",
    },
    ready: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: "Anchor Ready",
      color: "text-green-500",
      badgeVariant: "default",
    },
    failed: {
      icon: <AlertCircle className="w-3 h-3" />,
      label: "Failed",
      color: "text-destructive",
      badgeVariant: "destructive",
    },
    outdated: {
      icon: <AlertTriangle className="w-3 h-3" />,
      label: "Outdated",
      color: "text-yellow-500",
      badgeVariant: "outline",
    },
  };

  const config = statusConfig[status];
  const needsAction = status !== "ready" && status !== "generating";
  const isGenerating = status === "generating" || isCreating;

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1">
        {/* Crop thumbnail preview */}
        {cropThumbnailUrl && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-6 h-6 rounded overflow-hidden border border-border">
                  <img 
                    src={cropThumbnailUrl} 
                    alt="Crop" 
                    className="w-full h-full object-cover"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <img 
                  src={cropThumbnailUrl} 
                  alt="Crop preview" 
                  className="w-32 h-32 object-cover rounded"
                />
                <p className="text-xs mt-1 text-center">Scan crop ready</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        {/* Anchor status button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={needsAction ? "outline" : "ghost"}
                className={cn(
                  "h-6 w-6",
                  status === "ready" && "text-status-approved hover:text-status-approved/80",
                  status === "failed" && "text-destructive hover:text-destructive",
                  status === "outdated" && "text-status-running hover:text-status-running/80"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (needsAction && !isGenerating) {
                    onCreateAnchor(markerId);
                  }
                }}
                disabled={disabled || isGenerating || status === "ready"}
              >
                {isGenerating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : hasScanCrop && status === "ready" ? (
                  <Image className="w-3 h-3" />
                ) : (
                  config.icon
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="font-medium">{config.label}</p>
              {hasScanCrop && <p className="text-xs text-muted-foreground">Scan crop: ✓</p>}
              {anchorErrorMessage && (
                <p className="text-xs text-destructive mt-1">{anchorErrorMessage}</p>
              )}
              {status === "outdated" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Camera was moved - anchor needs refresh
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Full inline variant
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={config.badgeVariant}
        className={cn(
          "text-xs gap-1",
          config.color
        )}
      >
        {isGenerating ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          config.icon
        )}
        {config.label}
      </Badge>

      {needsAction && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          onClick={(e) => {
            e.stopPropagation();
            onCreateAnchor(markerId);
          }}
          disabled={disabled || isGenerating}
        >
          {status === "outdated" ? (
            <>
              <RefreshCw className="w-3 h-3 mr-1" />
              Refresh
            </>
          ) : status === "failed" ? (
            <>
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </>
          ) : (
            <>
              <Camera className="w-3 h-3 mr-1" />
              Create
            </>
          )}
        </Button>
      )}

      {/* Reset button when crop exists */}
      {hasScanCrop && onResetCrop && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2 text-muted-foreground hover:text-destructive"
              disabled={disabled || isGenerating || isResetting}
              onClick={(e) => e.stopPropagation()}
            >
              {isResetting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Screenshot?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the current crop for "{markerLabel}" and require taking a new screenshot.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onResetCrop(markerId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {anchorErrorMessage && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertCircle className="w-4 h-4 text-destructive cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs max-w-[200px]">{anchorErrorMessage}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});
