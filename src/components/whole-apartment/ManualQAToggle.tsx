import { memo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useManualQA } from "@/contexts/ManualQAContext";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const ManualQAToggle = memo(function ManualQAToggle() {
  const { manualQAEnabled, setManualQAEnabled } = useManualQA();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/50">
            {manualQAEnabled ? (
              <ShieldCheck className="w-4 h-4 text-primary" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            )}
            <Label
              htmlFor="manual-qa-toggle"
              className="text-xs font-medium cursor-pointer"
            >
              Manual QA
            </Label>
            <Switch
              id="manual-qa-toggle"
              checked={manualQAEnabled}
              onCheckedChange={setManualQAEnabled}
              className="scale-75"
            />
            <Badge
              variant={manualQAEnabled ? "default" : "outline"}
              className="text-[10px] px-1.5 py-0"
            >
              {manualQAEnabled ? "ON" : "OFF"}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="text-xs">
            {manualQAEnabled
              ? "Human approval required after every AI-QA pass. Recommended for production safety."
              : "AI-QA will auto-advance pipeline. Only enable when system is fully trusted."}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
