import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Image, Play } from "lucide-react";

interface Upload {
  id: string;
  bucket: string;
  path: string;
  original_filename: string | null;
}

interface ImageSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panoramas: Upload[];
  imagePreviews: Record<string, string>;
  onConfirm: (selectedIds: string[]) => void;
  isLoading: boolean;
}

export function ImageSelectionDialog({
  open,
  onOpenChange,
  panoramas,
  imagePreviews,
  onConfirm,
  isLoading
}: ImageSelectionDialogProps) {
  const [selectionMode, setSelectionMode] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleImage = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleConfirm = () => {
    if (selectionMode === "all") {
      onConfirm(panoramas.map(p => p.id));
    } else {
      onConfirm(Array.from(selectedIds));
    }
  };

  const canConfirm = selectionMode === "all" || selectedIds.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Select Images to Process
          </DialogTitle>
          <DialogDescription>
            Choose which panoramas to apply the changes to
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup
            value={selectionMode}
            onValueChange={(value: "all" | "selected") => setSelectionMode(value)}
            className="space-y-3"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="all" id="all" />
              <Label htmlFor="all" className="font-medium cursor-pointer">
                Apply to all images ({panoramas.length})
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="selected" id="selected" />
              <Label htmlFor="selected" className="font-medium cursor-pointer">
                Choose specific images
              </Label>
            </div>
          </RadioGroup>

          {selectionMode === "selected" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg border border-border/50 max-h-64 overflow-y-auto">
              {panoramas.map((pano) => (
                <div
                  key={pano.id}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    selectedIds.has(pano.id)
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  onClick={() => handleToggleImage(pano.id)}
                >
                  <div className="aspect-video bg-muted">
                    {imagePreviews[pano.id] ? (
                      <img
                        src={imagePreviews[pano.id]}
                        alt={pano.original_filename || "Panorama"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="absolute top-2 left-2">
                    <Checkbox
                      checked={selectedIds.has(pano.id)}
                      className="bg-background/80 border-border"
                    />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-background/80 px-2 py-1">
                    <p className="text-xs truncate">{pano.original_filename || "Image"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectionMode === "selected" && selectedIds.size > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} image{selectedIds.size !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Create Batch Job{selectionMode === "all" || selectedIds.size > 1 ? ` (${selectionMode === "all" ? panoramas.length : selectedIds.size} images)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
