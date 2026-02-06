import { memo, useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { 
  ChevronDown, ChevronRight, Folder, FolderOpen, Layers, MoreVertical, Trash2, X, CheckSquare
} from "lucide-react";
import { DeletePipelineRunDialog } from "./DeletePipelineRunDialog";
import { useDeletePipelineRun } from "@/hooks/useDeletePipelineRun";

export interface PipelineCreation {
  id: string;
  bucket: string;
  path: string;
  kind: string;
  original_filename: string | null;
  created_at: string;
  source_type: "pipeline_step";
  source_id: string;
  source_step?: number;
  pipeline_id?: string;
  space_id?: string;
  space_name?: string;
  ratio?: string | null;
  quality?: string | null;
}

interface PipelineRunGroup {
  pipelineId: string;
  pipelineName: string;
  createdAt: string;
  steps: {
    stepNumber: number;
    stepLabel: string;
    images: PipelineCreation[];
  }[];
  totalImages: number;
}

interface PipelineRunsFolderProps {
  creations: PipelineCreation[];
  imagePreviews: Record<string, string>;
  thumbnailSize: number;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  renderCreation: (creation: PipelineCreation) => React.ReactNode;
  projectId?: string;
}

// Step number to label mapping
const STEP_LABELS: Record<number, string> = {
  0: "Scene Analysis",
  1: "Top-Down Layout",
  2: "Style Top-Down",
  3: "Space Detection",
  4: "Room Renders",
  5: "Panoramas",
  6: "Final 360°",
};

function getStepLabel(stepNumber: number): string {
  return STEP_LABELS[stepNumber] || `Step ${stepNumber}`;
}

// Group creations by pipeline and step
function groupByPipelineAndStep(creations: PipelineCreation[]): PipelineRunGroup[] {
  const pipelineMap = new Map<string, {
    pipelineId: string;
    createdAt: string;
    stepMap: Map<number, PipelineCreation[]>;
  }>();

  creations.forEach(creation => {
    const pipelineId = creation.pipeline_id || creation.source_id || "unknown";
    const stepNumber = creation.source_step ?? 0;

    if (!pipelineMap.has(pipelineId)) {
      pipelineMap.set(pipelineId, {
        pipelineId,
        createdAt: creation.created_at,
        stepMap: new Map(),
      });
    }

    const pipeline = pipelineMap.get(pipelineId)!;
    if (!pipeline.stepMap.has(stepNumber)) {
      pipeline.stepMap.set(stepNumber, []);
    }
    pipeline.stepMap.get(stepNumber)!.push(creation);
  });

  // Convert to array and sort
  const groups: PipelineRunGroup[] = [];
  
  pipelineMap.forEach((pipeline) => {
    const steps: PipelineRunGroup["steps"] = [];
    
    // Sort steps by step number
    const sortedSteps = Array.from(pipeline.stepMap.entries()).sort((a, b) => a[0] - b[0]);
    
    sortedSteps.forEach(([stepNumber, images]) => {
      steps.push({
        stepNumber,
        stepLabel: getStepLabel(stepNumber),
        images: images.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
      });
    });

    const totalImages = steps.reduce((sum, s) => sum + s.images.length, 0);

    groups.push({
      pipelineId: pipeline.pipelineId,
      pipelineName: `Run ${pipeline.pipelineId.slice(0, 8)}`,
      createdAt: pipeline.createdAt,
      steps,
      totalImages,
    });
  });

  // Sort by creation date, newest first
  groups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return groups;
}

// Individual step section (collapsible)
const StepSection = memo(function StepSection({
  step,
  thumbnailSize,
  renderCreation,
}: {
  step: PipelineRunGroup["steps"][0];
  thumbnailSize: number;
  renderCreation: (creation: PipelineCreation) => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 h-9 pl-8 text-sm font-medium hover:bg-muted/50"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Layers className="h-4 w-4 text-primary" />
          <span>Step {step.stepNumber}: {step.stepLabel}</span>
          <Badge variant="secondary" className="ml-auto text-xs">
            {step.images.length}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div 
          className="pl-12 pr-4 pb-3 grid gap-3"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`,
          }}
        >
          {step.images.map(creation => renderCreation(creation))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

// Individual pipeline run section (collapsible)
const PipelineRunSection = memo(function PipelineRunSection({
  group,
  thumbnailSize,
  renderCreation,
  defaultOpen = true,
  onDeleteClick,
  isDeleting,
  isFolderSelectionMode,
  isSelected,
  onToggleFolderSelect,
}: {
  group: PipelineRunGroup;
  thumbnailSize: number;
  renderCreation: (creation: PipelineCreation) => React.ReactNode;
  defaultOpen?: boolean;
  onDeleteClick: (pipelineId: string) => void;
  isDeleting: boolean;
  isFolderSelectionMode: boolean;
  isSelected: boolean;
  onToggleFolderSelect: (pipelineId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg bg-card">
      <div className="flex items-center">
        {/* Folder selection checkbox */}
        {isFolderSelectionMode && (
          <div 
            className="pl-4 pr-2 py-3 flex items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleFolderSelect(group.pipelineId)}
              className="h-5 w-5"
              disabled={isDeleting}
            />
          </div>
        )}
        
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            className={`flex-1 justify-start gap-2 h-12 px-4 rounded-lg rounded-r-none hover:bg-muted/50 ${
              isFolderSelectionMode ? "pl-2" : ""
            } ${isSelected ? "bg-primary/5" : ""}`}
            disabled={isDeleting}
          >
            {isOpen ? (
              <FolderOpen className="h-5 w-5 text-primary" />
            ) : (
              <Folder className="h-5 w-5 text-muted-foreground" />
            )}
            <div className="flex flex-col items-start gap-0.5 flex-1">
              <span className="font-medium">{group.pipelineName}</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(group.createdAt), "MMM d, yyyy HH:mm")}
              </span>
            </div>
            <Badge variant="outline" className="text-xs">
              {group.totalImages} images
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {group.steps.length} steps
            </Badge>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-2" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-2" />
            )}
          </Button>
        </CollapsibleTrigger>
        
        {!isFolderSelectionMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-12 w-10 rounded-l-none border-l"
                disabled={isDeleting}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => onDeleteClick(group.pipelineId)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete this Pipeline Run
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <CollapsibleContent>
        <div className="border-t">
          {group.steps.map(step => (
            <StepSection
              key={`${group.pipelineId}-step-${step.stepNumber}`}
              step={step}
              thumbnailSize={thumbnailSize}
              renderCreation={renderCreation}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export const PipelineRunsFolder = memo(function PipelineRunsFolder({
  creations,
  imagePreviews,
  thumbnailSize,
  isSelectionMode,
  selectedIds,
  onToggleSelect,
  renderCreation,
  projectId,
}: PipelineRunsFolderProps) {
  const groups = useMemo(() => groupByPipelineAndStep(creations), [creations]);
  
  // Folder-level selection state (separate from image selection)
  const [isFolderSelectionMode, setIsFolderSelectionMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  
  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPipelineToDelete, setSelectedPipelineToDelete] = useState<PipelineRunGroup | null>(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  
  const deleteMutation = useDeletePipelineRun(projectId);

  const handleDeleteClick = (pipelineId: string) => {
    const group = groups.find(g => g.pipelineId === pipelineId);
    if (group) {
      setSelectedPipelineToDelete(group);
      setBulkDeleteMode(false);
      setDeleteDialogOpen(true);
    }
  };

  const handleToggleFolderSelect = useCallback((pipelineId: string) => {
    setSelectedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(pipelineId)) {
        next.delete(pipelineId);
      } else {
        next.add(pipelineId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedFolderIds(new Set(groups.map(g => g.pipelineId)));
  }, [groups]);

  const handleClearSelection = useCallback(() => {
    setSelectedFolderIds(new Set());
  }, []);

  const handleExitFolderSelectionMode = useCallback(() => {
    setIsFolderSelectionMode(false);
    setSelectedFolderIds(new Set());
  }, []);

  const handleBulkDeleteClick = useCallback(() => {
    if (selectedFolderIds.size === 0) return;
    setBulkDeleteMode(true);
    setSelectedPipelineToDelete(null);
    setDeleteDialogOpen(true);
  }, [selectedFolderIds]);

  // Calculate bulk stats for delete dialog
  const bulkDeleteStats = useMemo(() => {
    const selectedGroups = groups.filter(g => selectedFolderIds.has(g.pipelineId));
    const totalSteps = selectedGroups.reduce((sum, g) => sum + g.steps.length, 0);
    const totalImages = selectedGroups.reduce((sum, g) => sum + g.totalImages, 0);
    return { count: selectedGroups.length, totalSteps, totalImages, groups: selectedGroups };
  }, [groups, selectedFolderIds]);

  // Handle bulk deletion sequentially
  const [bulkDeleteIndex, setBulkDeleteIndex] = useState(0);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (bulkDeleteMode) {
      // Bulk delete - process all selected folders
      setIsBulkDeleting(true);
      const idsToDelete = Array.from(selectedFolderIds);
      
      for (let i = 0; i < idsToDelete.length; i++) {
        setBulkDeleteIndex(i);
        try {
          await deleteMutation.mutateAsync({ pipelineId: idsToDelete[i] });
        } catch (error) {
          console.error(`Failed to delete pipeline ${idsToDelete[i]}:`, error);
          // Continue with remaining deletions
        }
      }
      
      setIsBulkDeleting(false);
      setBulkDeleteIndex(0);
      setDeleteDialogOpen(false);
      setSelectedFolderIds(new Set());
      setIsFolderSelectionMode(false);
      setBulkDeleteMode(false);
    } else if (selectedPipelineToDelete) {
      // Single delete
      deleteMutation.mutate(
        { pipelineId: selectedPipelineToDelete.pipelineId },
        {
          onSuccess: () => {
            setDeleteDialogOpen(false);
            setSelectedPipelineToDelete(null);
          },
        }
      );
    }
  };

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <Folder className="h-12 w-12 mb-4" />
            <p>No pipeline runs yet</p>
            <p className="text-sm">Start a Whole Apartment Pipeline to generate images</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Folder selection toolbar */}
      <div className="flex items-center justify-between mb-3">
        {isFolderSelectionMode ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExitFolderSelectionMode}
              className="gap-1"
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Badge variant="secondary">
              {selectedFolderIds.size} selected
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={selectedFolderIds.size === groups.length}
            >
              Select All
            </Button>
            {selectedFolderIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
              >
                Clear
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFolderSelectionMode(true)}
              className="gap-2"
            >
              <CheckSquare className="h-4 w-4" />
              Select Folders
            </Button>
          </div>
        )}
        
        {isFolderSelectionMode && selectedFolderIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDeleteClick}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Delete {selectedFolderIds.size} Folder{selectedFolderIds.size > 1 ? "s" : ""}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <PipelineRunSection
            key={group.pipelineId}
            group={group}
            thumbnailSize={thumbnailSize}
            renderCreation={renderCreation}
            defaultOpen={!isFolderSelectionMode && groups.indexOf(group) === 0}
            onDeleteClick={handleDeleteClick}
            isDeleting={
              (deleteMutation.isPending && selectedPipelineToDelete?.pipelineId === group.pipelineId) ||
              (isBulkDeleting && selectedFolderIds.has(group.pipelineId))
            }
            isFolderSelectionMode={isFolderSelectionMode}
            isSelected={selectedFolderIds.has(group.pipelineId)}
            onToggleFolderSelect={handleToggleFolderSelect}
          />
        ))}
      </div>

      {/* Single delete dialog */}
      {selectedPipelineToDelete && !bulkDeleteMode && (
        <DeletePipelineRunDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          pipelineId={selectedPipelineToDelete.pipelineId}
          pipelineName={selectedPipelineToDelete.pipelineName}
          createdAt={selectedPipelineToDelete.createdAt}
          stepsCount={selectedPipelineToDelete.steps.length}
          imagesCount={selectedPipelineToDelete.totalImages}
          isDeleting={deleteMutation.isPending}
          onConfirmDelete={handleConfirmDelete}
        />
      )}

      {/* Bulk delete dialog */}
      {bulkDeleteMode && (
        <DeletePipelineRunDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            if (!isBulkDeleting) {
              setDeleteDialogOpen(open);
              if (!open) {
                setBulkDeleteMode(false);
              }
            }
          }}
          pipelineId="bulk"
          pipelineName={`${bulkDeleteStats.count} Pipeline Runs`}
          createdAt=""
          stepsCount={bulkDeleteStats.totalSteps}
          imagesCount={bulkDeleteStats.totalImages}
          isDeleting={isBulkDeleting}
          onConfirmDelete={handleConfirmDelete}
          isBulkDelete
          bulkCount={bulkDeleteStats.count}
          bulkProgress={isBulkDeleting ? bulkDeleteIndex + 1 : 0}
        />
      )}
    </>
  );
});
