import { memo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStorage } from "@/hooks/useStorage";
import {
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Loader2,
  Clock,
  Eye,
} from "lucide-react";

export interface CollapsibleOutputPanelProps {
  title: string;
  stepNumber: number;
  status: "pending" | "running" | "needs_review" | "approved" | "rejected" | "failed";
  uploadId?: string | null;
  ratioUsed?: string;
  qualityUsed?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  onToggle?: (collapsed: boolean) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
    icon: <Clock className="w-3 h-3" />,
  },
  running: {
    label: "Generating",
    className: "bg-blue-500/20 text-blue-400",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  needs_review: {
    label: "Awaiting Approval",
    className: "bg-yellow-500/20 text-yellow-400",
    icon: <Eye className="w-3 h-3" />,
  },
  approved: {
    label: "Approved",
    className: "bg-primary/20 text-primary",
    icon: <Check className="w-3 h-3" />,
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/20 text-destructive",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/20 text-destructive",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

export const CollapsibleOutputPanel = memo(function CollapsibleOutputPanel({
  title,
  stepNumber,
  status,
  uploadId,
  ratioUsed,
  qualityUsed,
  defaultCollapsed = false,
  children,
  onToggle,
}: CollapsibleOutputPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const { getSignedViewUrl } = useStorage();

  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  const handleToggle = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    onToggle?.(newState);
    
    // Load thumbnail when collapsing if we have an uploadId
    if (newState && uploadId && !thumbnailUrl) {
      getSignedViewUrl("lookup", uploadId).then((result) => {
        if (result.signedUrl) {
          setThumbnailUrl(result.signedUrl);
        }
      });
    }
  };

  // Load thumbnail on mount if collapsed and has uploadId
  if (collapsed && uploadId && !thumbnailUrl) {
    getSignedViewUrl("lookup", uploadId).then((result) => {
      if (result.signedUrl) {
        setThumbnailUrl(result.signedUrl);
      }
    });
  }

  return (
    <Card className={cn(
      "border-border/50 overflow-hidden transition-all duration-200",
      collapsed && "hover:border-border"
    )}>
      {/* Clickable Header */}
      <div
        className={cn(
          "flex items-center justify-between p-3 cursor-pointer transition-colors",
          collapsed ? "bg-muted/30 hover:bg-muted/50" : "bg-muted/20 border-b border-border/50"
        )}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Thumbnail when collapsed */}
          {collapsed && thumbnailUrl && (
            <div className="w-12 h-12 rounded-md overflow-hidden bg-muted flex-shrink-0">
              <img
                src={thumbnailUrl}
                alt={title}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{title}</span>
              <Badge variant="outline" className="text-xs flex-shrink-0">
                Step {stepNumber}
              </Badge>
            </div>
            
            {/* Collapsed metadata row */}
            {collapsed && (
              <div className="flex items-center gap-2 mt-1">
                {ratioUsed && (
                  <Badge variant="secondary" className="text-xs">
                    {ratioUsed}
                  </Badge>
                )}
                {qualityUsed && (
                  <Badge variant="secondary" className="text-xs">
                    {qualityUsed}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Status Badge */}
          <Badge className={cn("text-xs", statusConfig.className)}>
            {statusConfig.icon}
            <span className="ml-1">{statusConfig.label}</span>
          </Badge>

          {/* Expand/Collapse button */}
          <Button variant="ghost" size="icon" className="h-8 w-8">
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible Content */}
      {!collapsed && (
        <CardContent className="p-0">
          {children}
        </CardContent>
      )}
    </Card>
  );
});
