import { memo, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ChevronDown,
  Image as ImageIcon,
  Eye,
  Play,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface ReferenceStyleAnalysis {
  analyzed_at?: string;
  design_ref_ids?: string[];
  style_data?: {
    design_style?: {
      primary?: string;
      secondary?: string[];
      mood_keywords?: string[];
    };
    color_palette?: {
      primary?: string;
      secondary?: string[];
      accent?: string[];
      temperature?: string;
    };
    materials?: {
      flooring?: string;
      walls?: string;
      wood_tone?: string;
      metal_finish?: string;
      fabrics?: string;
      stone?: string;
    };
    lighting?: {
      temperature?: string;
      intensity?: string;
      mood?: string;
    };
    style_rules?: {
      do?: string[];
      avoid?: string[];
    };
    summary_prompt?: string;
  };
  style_constraints_block?: string;
  summary?: string;
}

interface ReferenceStyleDebugPanelProps {
  pipelineId: string;
  projectId: string;
  designRefIds: string[];
  referenceStyleAnalysis: ReferenceStyleAnalysis | null;
  currentPhase: string;
  currentStep: number;
}

export const ReferenceStyleDebugPanel = memo(function ReferenceStyleDebugPanel({
  pipelineId,
  projectId,
  designRefIds,
  referenceStyleAnalysis,
  currentPhase,
  currentStep,
}: ReferenceStyleDebugPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const hasReferences = designRefIds.length > 0;
  const hasStyleAnalysis = !!referenceStyleAnalysis?.style_data;
  const hasStyleConstraintsBlock = !!referenceStyleAnalysis?.style_constraints_block;
  const isStep2Active = currentStep === 2 || currentPhase.includes("style");
  const isStep2Running = currentPhase === "style_running";
  
  // "Injected into Step 2" is YES if we have both style analysis AND the constraints block
  const isInjectedIntoStep2 = hasStyleAnalysis && hasStyleConstraintsBlock;
  
  // Determine status
  let status: "none" | "pending" | "analyzing" | "done" | "failed" = "none";
  if (!hasReferences) {
    status = "none";
  } else if (isAnalyzing) {
    status = "analyzing";
  } else if (hasStyleAnalysis) {
    status = "done";
  } else if (currentPhase === "space_analysis_running") {
    status = "analyzing";
  } else if (hasReferences && !hasStyleAnalysis) {
    status = "pending";
  }
  
  const styleData = referenceStyleAnalysis?.style_data;

  // Handler to run style analysis manually
  const handleAnalyzeStyle = useCallback(async () => {
    if (!hasReferences || isAnalyzing) return;
    
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-style-analysis", {
        body: {
          pipeline_id: pipelineId,
          design_ref_ids: designRefIds,
        },
      });

      if (error) {
        throw new Error(error.message || "Style analysis failed");
      }

      if (!data?.ok) {
        throw new Error(data?.error || "Style analysis failed");
      }

      toast({
        title: "Style analysis complete",
        description: data.style_analysis?.design_style?.primary 
          ? `Style: ${data.style_analysis.design_style.primary}`
          : "Style profile extracted successfully",
      });

      // Refresh pipeline data
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    } catch (err) {
      console.error("Style analysis error:", err);
      toast({
        title: "Style analysis failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [pipelineId, projectId, designRefIds, hasReferences, isAnalyzing, toast, queryClient]);
  
  return (
    <Card className={cn(
      "border-dashed transition-all",
      isStep2Active ? "border-primary/50 bg-primary/5" : "border-border/50"
    )}>
      <Collapsible defaultOpen={isStep2Active || status === "done"}>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-2 px-3 cursor-pointer hover:bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className={cn(
                  "w-4 h-4",
                  status === "done" ? "text-primary" : "text-muted-foreground"
                )} />
                <CardTitle className="text-xs font-medium">Design Reference Status</CardTitle>
                {isStep2Active && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">
                    Active
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Status Badge */}
                {status === "none" && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    No reference
                  </Badge>
                )}
                {status === "pending" && (
                  <Badge variant="outline" className="text-[10px] text-yellow-500">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Pending analysis
                  </Badge>
                )}
                {status === "analyzing" && (
                  <Badge variant="outline" className="text-[10px] text-blue-500">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing...
                  </Badge>
                )}
                {status === "done" && (
                  <Badge variant="outline" className="text-[10px] text-green-500">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Style analyzed
                  </Badge>
                )}
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 pb-2 px-3 text-xs space-y-2">
            {/* Reference detection */}
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Reference detected:</span>
              <span className={hasReferences ? "text-green-500 font-medium" : "text-muted-foreground"}>
                {hasReferences ? `YES (${designRefIds.length})` : "NO"}
              </span>
            </div>
            
            {/* Style analysis status */}
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Style analysis status:</span>
              <span className={cn(
                "font-medium",
                status === "done" ? "text-green-500" : 
                status === "analyzing" ? "text-blue-500" : 
                status === "pending" ? "text-yellow-500" : "text-muted-foreground"
              )}>
                {status}
              </span>
            </div>
            
            {/* Will be injected into Step 2 */}
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Injected into Step 2 prompt:</span>
              <span className={isInjectedIntoStep2 ? "text-green-500 font-medium" : "text-muted-foreground"}>
                {isInjectedIntoStep2 ? "YES" : "NO"}
              </span>
            </div>
            
            {/* Reference image attached */}
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Reference image in Step 2 payload:</span>
              <span className={hasReferences ? "text-green-500 font-medium" : "text-muted-foreground"}>
                {hasReferences ? "YES" : "NO"}
              </span>
            </div>
            
            {/* Style summary preview */}
            {styleData && (
              <div className="mt-2 space-y-1.5 bg-muted/50 rounded p-2">
                <div className="font-medium text-xs">Style Summary:</div>
                
                {styleData.design_style?.primary && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Style:</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {styleData.design_style.primary}
                    </Badge>
                    {styleData.design_style.mood_keywords?.slice(0, 3).map((kw, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                )}
                
                {styleData.color_palette?.primary && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Colors:</span>
                    <div 
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: styleData.color_palette.primary }}
                      title={styleData.color_palette.primary}
                    />
                    {styleData.color_palette.secondary?.slice(0, 2).map((c, i) => (
                      <div 
                        key={i}
                        className="w-4 h-4 rounded border"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                    <span className="text-muted-foreground text-[10px]">
                      ({styleData.color_palette.temperature})
                    </span>
                  </div>
                )}
                
                {styleData.materials?.flooring && (
                  <div className="flex items-start gap-1">
                    <span className="text-muted-foreground shrink-0">Materials:</span>
                    <span className="text-[10px] line-clamp-2">
                      {styleData.materials.flooring}, {styleData.materials.wood_tone}
                    </span>
                  </div>
                )}
                
                {referenceStyleAnalysis?.summary && (
                  <div className="mt-1 pt-1 border-t border-border/30">
                    <span className="text-[10px] text-muted-foreground line-clamp-2">
                      {referenceStyleAnalysis.summary}
                    </span>
                  </div>
                )}
              </div>
            )}
            
            {/* Action button + warning if no analysis but has references */}
            {hasReferences && !hasStyleAnalysis && (
              <div className="space-y-2">
                {status !== "analyzing" && (
                  <div className="flex items-center gap-1 text-warning bg-warning/10 p-1.5 rounded">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span className="text-[10px]">
                      Style not yet analyzed. Click the button below to analyze.
                    </span>
                  </div>
                )}
                <Button
                  size="sm"
                  variant={status === "done" ? "outline" : "default"}
                  onClick={handleAnalyzeStyle}
                  disabled={isAnalyzing || status === "analyzing"}
                  className="w-full"
                >
                  {isAnalyzing || status === "analyzing" ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Analyzing Style...
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 mr-1" />
                      Analyze Style
                    </>
                  )}
                </Button>
              </div>
            )}
            
            {/* Re-analyze button when style already exists */}
            {hasReferences && hasStyleAnalysis && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAnalyzeStyle}
                disabled={isAnalyzing}
                className="w-full"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Re-analyzing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Re-analyze Style
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});
