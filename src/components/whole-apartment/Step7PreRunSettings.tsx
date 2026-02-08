import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Settings2, Zap, Image, Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step7PreRunSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentQuality: string;
  onConfirm: (quality: "2K" | "4K") => void;
  isPending?: boolean;
  spaceCount: number;
}

/**
 * Step 7 Quality UI Gate
 * 
 * This component shows a pre-run settings panel ONLY before Step 7 (Merge) starts.
 * The only setting is: Output Quality: default 2K, optional switch to 4K.
 * 
 * Rules:
 * - This 4K toggle appears ONLY for Step 7 pre-run
 * - Quality is locked once Step 7 run starts
 * - Earlier steps (5-6) do NOT show quality options
 */
export const Step7PreRunSettings = memo(function Step7PreRunSettings({
  open,
  onOpenChange,
  currentQuality,
  onConfirm,
  isPending = false,
  spaceCount,
}: Step7PreRunSettingsProps) {
  const [selectedQuality, setSelectedQuality] = useState<"2K" | "4K">(
    currentQuality === "4K" ? "4K" : "2K"
  );

  const handleConfirm = () => {
    onConfirm(selectedQuality);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Step 7: Final 360° Merge Settings
          </DialogTitle>
          <DialogDescription>
            Configure output quality for the final panorama merge. This setting
            will be locked once the merge process begins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Summary Info */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 border border-border/50">
            <div className="flex items-center gap-2 text-sm">
              <Image className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Spaces to merge:</span>
              <Badge variant="secondary">{spaceCount}</Badge>
            </div>
          </div>

          {/* Quality Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Output Quality</Label>
              <Badge variant="outline" className="text-xs">
                Step 7 Only
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* 2K Option */}
              <button
                type="button"
                onClick={() => setSelectedQuality("2K")}
                className={cn(
                  "relative flex flex-col items-start p-4 rounded-lg border-2 transition-all",
                  selectedQuality === "2K"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="font-medium">2K</span>
                  <Badge variant="secondary" className="text-xs">
                    Default
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground text-left">
                  Fast processing, suitable for web and mobile viewing
                </p>
                {selectedQuality === "2K" && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                )}
              </button>

              {/* 4K Option */}
              <button
                type="button"
                onClick={() => setSelectedQuality("4K")}
                className={cn(
                  "relative flex flex-col items-start p-4 rounded-lg border-2 transition-all",
                  selectedQuality === "4K"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Image className="w-4 h-4 text-primary" />
                  <span className="font-medium">4K</span>
                  <Badge variant="outline" className="text-xs text-primary">
                    Premium
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground text-left">
                  High resolution for professional use and VR headsets
                </p>
                {selectedQuality === "4K" && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                )}
              </button>
            </div>

            {/* Warning about lock */}
            <div className="flex items-center gap-2 p-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                Quality setting will be locked after merge starts and displayed
                in job details.
              </span>
            </div>
          </div>

          {/* Note about earlier steps */}
          <div className="text-xs text-muted-foreground">
            <p>
              <strong>Note:</strong> Steps 5-6 (Renders & Panoramas) use a fixed
              quality setting to ensure consistency. Only the final merge step
              offers 4K output selection.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            <ArrowRight className="w-4 h-4 mr-2" />
            Start Merge ({selectedQuality})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default Step7PreRunSettings;
