import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface DeletePipelineRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  createdAt: string;
  stepsCount: number;
  imagesCount: number;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  // Bulk delete props
  isBulkDelete?: boolean;
  bulkCount?: number;
  bulkProgress?: number;
}

export function DeletePipelineRunDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  createdAt,
  stepsCount,
  imagesCount,
  isDeleting,
  onConfirmDelete,
  isBulkDelete = false,
  bulkCount = 0,
  bulkProgress = 0,
}: DeletePipelineRunDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const isConfirmValid = confirmText === "DELETE";

  // Reset confirm text when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setConfirmText("");
    }
  }, [open]);

  const handleOpenChange = (newOpen: boolean) => {
    if (!isDeleting) {
      setConfirmText("");
      onOpenChange(newOpen);
    }
  };

  const progressPercent = isBulkDelete && bulkCount > 0 
    ? Math.round((bulkProgress / bulkCount) * 100) 
    : 0;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {isBulkDelete 
              ? `Delete ${bulkCount} pipeline runs?` 
              : "Delete pipeline run?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This will permanently delete <strong>all outputs</strong>, logs, and reviews for {isBulkDelete ? "these pipeline runs" : "this pipeline run"}. 
                This action <strong>cannot be undone</strong>.
              </p>
              
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                {isBulkDelete ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Runs to delete:</span>
                      <span className="font-medium">{bulkCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total steps:</span>
                      <span>{stepsCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total images:</span>
                      <span>{imagesCount}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Run ID:</span>
                      <span className="font-mono text-xs">{pipelineName}</span>
                    </div>
                    {createdAt && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created:</span>
                        <span>{format(new Date(createdAt), "MMM d, yyyy HH:mm")}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Steps:</span>
                      <span>{stepsCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Images:</span>
                      <span>{imagesCount}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Bulk delete progress */}
              {isBulkDelete && isDeleting && bulkProgress > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Deleting...</span>
                    <span>{bulkProgress} of {bulkCount}</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>
              )}

              {!isDeleting && (
                <div className="space-y-2">
                  <Label htmlFor="confirm-delete" className="text-foreground">
                    Type <strong>DELETE</strong> to confirm:
                  </Label>
                  <Input
                    id="confirm-delete"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    disabled={isDeleting}
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirmDelete();
            }}
            disabled={!isConfirmValid || isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isBulkDelete ? `Deleting ${bulkProgress}/${bulkCount}…` : "Deleting…"}
              </>
            ) : (
              isBulkDelete ? `Delete ${bulkCount} Runs` : "Delete Run"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
