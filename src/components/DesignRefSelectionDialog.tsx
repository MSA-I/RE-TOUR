import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Image, Sparkles } from "lucide-react";
import { format } from "date-fns";

interface Upload {
  id: string;
  bucket: string;
  path: string;
  original_filename: string | null;
  created_at: string | null;
}

interface DesignRefSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designRefs: Upload[];
  imagePreviews: Record<string, string>;
  onConfirm: (selectedIds: string[]) => void;
  isLoading: boolean;
}

const ROOM_LABELS = [
  { value: "none", label: "No Label" },
  { value: "kitchen", label: "Kitchen" },
  { value: "living", label: "Living Room" },
  { value: "bedroom", label: "Bedroom" },
  { value: "bathroom", label: "Bathroom" },
  { value: "generic", label: "Generic Style" },
];

export function DesignRefSelectionDialog({
  open,
  onOpenChange,
  designRefs,
  imagePreviews,
  onConfirm,
  isLoading
}: DesignRefSelectionDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(designRefs.map(r => r.id))); // Select all by default
      setLabels({});
    }
  }, [open, designRefs]);

  const handleToggleImage = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(designRefs.map(r => r.id)));
  };

  const handleSelectNone = () => {
    setSelectedIds(new Set());
  };

  const handleLabelChange = (id: string, label: string) => {
    setLabels(prev => ({ ...prev, [id]: label }));
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedIds));
  };

  const canConfirm = selectedIds.size > 0 && selectedIds.size <= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Select Reference Images
          </DialogTitle>
          <DialogDescription>
            Choose 1-5 design reference images to mix into a unified style prompt
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Quick Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={handleSelectNone}>
                Select None
              </Button>
            </div>
            <span className={`text-sm ${selectedIds.size > 5 ? "text-destructive" : "text-muted-foreground"}`}>
              {selectedIds.size} of {designRefs.length} selected {selectedIds.size > 5 && "(max 5)"}
            </span>
          </div>

          {/* Image Grid */}
          <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
            {designRefs.map((ref) => (
              <div
                key={ref.id}
                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                  selectedIds.has(ref.id)
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <div 
                  className="aspect-video bg-muted cursor-pointer"
                  onClick={() => handleToggleImage(ref.id)}
                >
                  {imagePreviews[ref.id] ? (
                    <img
                      src={imagePreviews[ref.id]}
                      alt={ref.original_filename || "Reference"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="absolute top-2 left-2" onClick={() => handleToggleImage(ref.id)}>
                  <Checkbox
                    checked={selectedIds.has(ref.id)}
                    className="bg-background/80 border-border"
                  />
                </div>
                <div className="bg-background/95 px-2 py-1.5 space-y-1">
                  <p className="text-xs truncate font-medium">{ref.original_filename || "Image"}</p>
                  <Select
                    value={labels[ref.id] || ""}
                    onValueChange={(value) => handleLabelChange(ref.id, value)}
                  >
                    <SelectTrigger className="h-6 text-[10px]">
                      <SelectValue placeholder="Optional label..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ROOM_LABELS.map((label) => (
                        <SelectItem key={label.value} value={label.value} className="text-xs">
                          {label.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Mix {selectedIds.size} Reference{selectedIds.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}