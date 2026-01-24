import { memo } from "react";
import { cn } from "@/lib/utils";
import { ASPECT_RATIOS, AspectRatioType } from "@/lib/constants/ratios";

// Re-export for compatibility
export { ASPECT_RATIOS };


interface AspectRatioPreviewProps {
  ratio: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
}

// Parse ratio string to get width/height proportions
function parseRatio(ratio: string): { width: number; height: number } {
  const parts = ratio.split(":").map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) {
    return { width: 1, height: 1 };
  }
  return { width: parts[0], height: parts[1] };
}

// Normalize dimensions to fit within a container while preserving proportions
function getNormalizedDimensions(
  ratio: string,
  maxSize: number
): { width: number; height: number } {
  const { width, height } = parseRatio(ratio);
  
  // Normalize to max dimension
  if (width >= height) {
    const normalizedWidth = maxSize;
    const normalizedHeight = (height / width) * maxSize;
    return { width: normalizedWidth, height: normalizedHeight };
  } else {
    const normalizedHeight = maxSize;
    const normalizedWidth = (width / height) * maxSize;
    return { width: normalizedWidth, height: normalizedHeight };
  }
}

const SIZE_CONFIG = {
  sm: { maxSize: 16, containerSize: 20 },
  md: { maxSize: 24, containerSize: 28 },
  lg: { maxSize: 32, containerSize: 36 }
};

function AspectRatioPreviewComponent({
  ratio,
  className,
  size = "sm",
  selected = false
}: AspectRatioPreviewProps) {
  const { maxSize, containerSize } = SIZE_CONFIG[size];
  const { width, height } = getNormalizedDimensions(ratio, maxSize);
  
  return (
    <div 
      className={cn(
        "flex items-center justify-center flex-shrink-0",
        className
      )}
      style={{ width: containerSize, height: containerSize }}
    >
      <div
        className={cn(
          "rounded-[2px] border transition-colors",
          selected 
            ? "border-primary bg-primary/20" 
            : "border-muted-foreground/40 bg-muted/50"
        )}
        style={{ 
          width: Math.max(width, 4), 
          height: Math.max(height, 4) 
        }}
      >
        {/* Inner grid lines for visual texture */}
        <div className="w-full h-full relative overflow-hidden rounded-[1px]">
          <div className={cn(
            "absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px opacity-30",
            selected ? "opacity-40" : "opacity-20"
          )}>
            {[...Array(9)].map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "border-[0.5px]",
                  selected ? "border-primary/50" : "border-muted-foreground/30"
                )} 
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const AspectRatioPreview = memo(AspectRatioPreviewComponent);

// Helper component for SelectItem with preview
interface AspectRatioSelectItemProps {
  value: string;
  showLabel?: boolean;
}

export function AspectRatioSelectItemContent({ 
  value, 
  showLabel = true 
}: AspectRatioSelectItemProps) {
  const ratioInfo = ASPECT_RATIOS[value as keyof typeof ASPECT_RATIOS];
  
  return (
    <div className="flex items-center gap-2">
      <AspectRatioPreview ratio={value} size="sm" />
      <span className="font-medium">{value}</span>
      {showLabel && ratioInfo && (
        <span className="text-muted-foreground text-xs">({ratioInfo.label})</span>
      )}
    </div>
  );
}
