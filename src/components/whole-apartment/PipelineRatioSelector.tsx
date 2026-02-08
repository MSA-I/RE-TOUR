import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Lock, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RatioOption {
  value: string;
  label: string;
  description: string;
  previewAspect: string; // CSS aspect-ratio
}

const RENDER_RATIOS: RatioOption[] = [
  { value: "16:9", label: "16:9", description: "Widescreen", previewAspect: "16/9" },
  { value: "21:9", label: "21:9", description: "Ultra-wide", previewAspect: "21/9" },
  { value: "4:3", label: "4:3", description: "Classic", previewAspect: "4/3" },
  { value: "1:1", label: "1:1", description: "Square", previewAspect: "1/1" },
];

const PANORAMA_RATIO: RatioOption = {
  value: "2:1",
  label: "2:1",
  description: "Equirectangular",
  previewAspect: "2/1",
};

interface PipelineRatioSelectorProps {
  value: string;
  onChange: (value: string) => void;
  type?: "render" | "panorama";
  disabled?: boolean;
  locked?: boolean;
  className?: string;
}

function RatioPreview({ aspect, selected }: { aspect: string; selected?: boolean }) {
  return (
    <div
      className={cn(
        "w-8 h-5 border-2 rounded-sm flex items-center justify-center",
        selected
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/30"
      )}
      style={{ aspectRatio: aspect }}
    />
  );
}

export const PipelineRatioSelector = memo(function PipelineRatioSelector({
  value,
  onChange,
  type = "render",
  disabled = false,
  locked = false,
  className,
}: PipelineRatioSelectorProps) {
  const ratios = type === "panorama" ? [PANORAMA_RATIO] : RENDER_RATIOS;

  // If locked, show locked display instead of selector
  if (locked) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          {type === "panorama" ? "Panorama Ratio" : "Output Ratio"}
          <Lock className="w-3 h-3" />
        </Label>
        <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
          <RatioPreview 
            aspect={ratios.find(r => r.value === value)?.previewAspect || "16/9"} 
            selected 
          />
          <span className="font-medium">{value}</span>
          <Badge variant="outline" className="text-xs ml-auto">
            Locked
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">
        {type === "panorama" ? "Panorama Ratio" : "Output Ratio"}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full h-9">
          <SelectValue placeholder="Select ratio" />
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {ratios.map((ratio) => (
            <SelectItem key={ratio.value} value={ratio.value}>
              <div className="flex items-center gap-3">
                <RatioPreview aspect={ratio.previewAspect} selected={value === ratio.value} />
                <span className="font-medium">{ratio.label}</span>
                <span className="text-xs text-muted-foreground">{ratio.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
});

// Quality selector companion with Step 4+ policy
interface PipelineQualitySelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showStep4Hint?: boolean;
  className?: string;
}

const QUALITY_OPTIONS = [
  { value: "2K", label: "2K", description: "Standard" },
  { value: "4K", label: "4K", description: "High Quality" },
];

export const PipelineQualitySelector = memo(function PipelineQualitySelector({
  value,
  onChange,
  disabled = false,
  showStep4Hint = false,
  className,
}: PipelineQualitySelectorProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {showStep4Hint ? "Quality for Renders, Panoramas & Merge" : "Output Quality"}
        {showStep4Hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p>Steps 0-3 always run in 2K for stability and memory efficiency.</p>
              <p className="mt-1">This setting affects Step 4+ (Renders, Panoramas, and Final 360 Merge).</p>
            </TooltipContent>
          </Tooltip>
        )}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full h-9">
          <SelectValue placeholder="Select quality" />
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {QUALITY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showStep4Hint && (
        <p className="text-xs text-muted-foreground">
          Applies to Step 4+ (Renders, Panoramas, Final 360).
        </p>
      )}
    </div>
  );
});

