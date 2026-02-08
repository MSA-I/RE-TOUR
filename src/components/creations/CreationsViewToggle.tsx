import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LayoutGrid, FolderTree } from "lucide-react";

export type CreationsViewMode = "all" | "folders";

interface CreationsViewToggleProps {
  viewMode: CreationsViewMode;
  onViewModeChange: (mode: CreationsViewMode) => void;
  pipelineCount: number;
  otherCount: number;
}

export const CreationsViewToggle = memo(function CreationsViewToggle({
  viewMode,
  onViewModeChange,
  pipelineCount,
  otherCount,
}: CreationsViewToggleProps) {
  return (
    <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/30">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={viewMode === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-3"
            onClick={() => onViewModeChange("all")}
          >
            <LayoutGrid className="h-4 w-4 mr-2" />
            All
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          View all creations in a flat grid
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={viewMode === "folders" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-3"
            onClick={() => onViewModeChange("folders")}
          >
            <FolderTree className="h-4 w-4 mr-2" />
            Pipeline Runs
            {pipelineCount > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                {pipelineCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          View pipeline outputs organized by run and step
        </TooltipContent>
      </Tooltip>
    </div>
  );
});
