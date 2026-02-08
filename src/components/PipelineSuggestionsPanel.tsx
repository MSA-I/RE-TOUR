import { useState, useEffect, useCallback, memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, RefreshCw, Wand2, Check, Lock, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePipelinePromptComposer } from "@/hooks/usePipelinePromptComposer";

interface PipelineSuggestion {
  id: string;
  step_number: number;
  category: string;
  title: string;
  prompt: string;
  is_generated: boolean;
}

interface PipelineSuggestionsPanelProps {
  currentStep: number;
  onApplyPrompt: (stepNumber: number, prompt: string) => void;
  className?: string;
  isInReview?: boolean; // Lock panel during Approve/Reject decision
  isStepRunning?: boolean; // Lock panel while any step is running
  isStepRejected?: boolean; // True when current step is in rejected state (unlocks suggestions for correction)
  // Step 2 mutual exclusion
  step2HasReferences?: boolean; // True when Step 2 has design references selected
  onStep2SuggestionsActive?: (active: boolean) => void; // Notify parent when suggestions are in use
  // Whole Apartment mode - hides legacy suggestions
  isWholeApartmentMode?: boolean;
}

// Step 1 is RESTRICTED to realistic imagery only - no artistic/abstract/blueprint styles
const STEP_1_ALLOWED_CATEGORIES = ["realistic", "photorealistic", "architectural", "professional"];

// Step 3 is RESTRICTED to camera-angle related categories only
const STEP_3_ALLOWED_CATEGORIES = ["camera", "angle", "framing", "perspective", "composition"];

// Step 2 is RESTRICTED to design-style categories only (no camera logic, no materials/lighting)
const STEP_2_ALLOWED_CATEGORIES = ["style", "aesthetic", "ambiance", "mood"];

const STEP_CATEGORY_LABELS: Record<number, Record<string, string>> = {
  1: {
    realistic: "Realistic",
    photorealistic: "Photorealistic",
    architectural: "Architectural",
    professional: "Professional"
  },
  2: {
    style: "Design Style",
    aesthetic: "Aesthetic",
    ambiance: "Ambiance",
    mood: "Mood"
  },
  3: {
    camera: "Camera Angle",
    angle: "Viewing Angle",
    framing: "Framing",
    perspective: "Perspective",
    composition: "Composition"
  },
  4: {
    panorama: "360° Panorama",
    area: "Room Area"
  }
};

// 4-step pipeline names (removed Approval Gate)
const STEP_NAMES: Record<number, string> = {
  1: "2D → Top-Down 3D",
  2: "Style Interior",
  3: "Camera-Angle Render",
  4: "360° Panorama"
};

function PipelineSuggestionsPanelComponent({ 
  currentStep, 
  onApplyPrompt,
  className,
  isInReview = false,
  isStepRunning = false,
  isStepRejected = false,
  step2HasReferences = false,
  onStep2SuggestionsActive,
  isWholeApartmentMode = false,
}: PipelineSuggestionsPanelProps) {
  // All hooks MUST be called before any early returns
  const [suggestionsByStep, setSuggestionsByStep] = useState<Record<number, PipelineSuggestion[]>>({});
  const [categoriesByStep, setCategoriesByStep] = useState<Record<number, string[]>>({});
  const [selectedCategory, setSelectedCategory] = useState<Record<number, string | null>>({});
  const [isLoading, setIsLoading] = useState<Record<number, boolean>>({});
  const [isGenerating, setIsGenerating] = useState<Record<number, boolean>>({});
  
  // Multi-select suggestions per step
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<number, PipelineSuggestion[]>>({});
  // Working prompt (user custom text)
  const [workingPrompt, setWorkingPrompt] = useState<Record<number, string>>({});
  // Composed result
  const [composedResult, setComposedResult] = useState<Record<number, { 
    template_name: string; 
    prompt: string; 
    summary: string;
  } | null>>({});
  // Track if prompt has been "used" (locked state)
  const [promptUsed, setPromptUsed] = useState<Record<number, boolean>>({});
  
  const { toast } = useToast();
  const { isComposing, composePrompt } = usePipelinePromptComposer();

  // If Whole Apartment mode is active, don't render legacy suggestions
  // This check comes AFTER all hooks are called
  if (isWholeApartmentMode) {
    return (
      <div className={className}>
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">Legacy suggestions are disabled in Whole Apartment Pipeline mode.</p>
          <p className="text-xs mt-1">The pipeline uses automatic render plans based on detected spaces.</p>
        </div>
      </div>
    );
  }

  const fetchSuggestions = useCallback(async (stepNumber: number, category?: string) => {
    setIsLoading(prev => ({ ...prev, [stepNumber]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("get-pipeline-suggestions", {
        body: { step_number: stepNumber, category }
      });

      if (error) throw error;

      setSuggestionsByStep(prev => ({ ...prev, [stepNumber]: data.suggestions || [] }));
      setCategoriesByStep(prev => ({ ...prev, [stepNumber]: data.categories || [] }));
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
    } finally {
      setIsLoading(prev => ({ ...prev, [stepNumber]: false }));
    }
  }, []);

  const generateMore = useCallback(async (stepNumber: number) => {
    setIsGenerating(prev => ({ ...prev, [stepNumber]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("get-pipeline-suggestions", {
        body: { step_number: stepNumber, category: selectedCategory[stepNumber], generate_more: true }
      });

      if (error) throw error;

      setSuggestionsByStep(prev => ({ ...prev, [stepNumber]: data.suggestions || [] }));
      setCategoriesByStep(prev => ({ ...prev, [stepNumber]: data.categories || [] }));
      
      if (data.generated_count) {
        toast({ title: `Generated ${data.generated_count} new suggestions` });
      }
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      toast({
        title: "Failed to generate suggestions",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(prev => ({ ...prev, [stepNumber]: false }));
    }
  }, [selectedCategory, toast]);

  // Track if initial fetch is done
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Fetch suggestions for all steps on mount ONLY (now 4 steps)
  useEffect(() => {
    if (initialFetchDone) return;
    
    const fetchAll = async () => {
      // Fetch sequentially to avoid overwhelming the backend
      for (const step of [1, 2, 3, 4]) {
        await fetchSuggestions(step, undefined);
      }
      setInitialFetchDone(true);
    };
    
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Refetch when category changes (but NOT on initial mount)
  const handleCategoryChange = useCallback((stepNumber: number, category: string | null) => {
    setSelectedCategory(prev => ({ ...prev, [stepNumber]: category }));
    fetchSuggestions(stepNumber, category || undefined);
  }, [fetchSuggestions]);

  const handleToggleSuggestion = (stepNumber: number, suggestion: PipelineSuggestion) => {
    if (stepNumber !== currentStep) return; // Don't allow selecting locked steps
    
    setSelectedSuggestions(prev => {
      const current = prev[stepNumber] || [];
      const isSelected = current.some(s => s.id === suggestion.id);
      
      const newSelected = isSelected 
        ? current.filter(s => s.id !== suggestion.id)
        : [...current, suggestion];
      
      // Notify parent when Step 2 suggestions become active (for mutual exclusion)
      if (stepNumber === 2 && onStep2SuggestionsActive) {
        onStep2SuggestionsActive(newSelected.length > 0);
      }
      
      return { ...prev, [stepNumber]: newSelected };
    });
    
    // Clear composed result when selections change
    setComposedResult(prev => ({ ...prev, [stepNumber]: null }));
  };

  const handleComposePrompt = async (stepNumber: number) => {
    const suggestions = selectedSuggestions[stepNumber] || [];
    const userText = workingPrompt[stepNumber] || "";
    
    if (suggestions.length === 0 && !userText.trim()) {
      toast({ title: "Please select suggestions or enter custom text", variant: "destructive" });
      return;
    }

    // Reset locked state when composing new prompt
    setPromptUsed(prev => ({ ...prev, [stepNumber]: false }));

    const result = await composePrompt({
      stepNumber,
      selectedSuggestions: suggestions,
      userPromptText: userText
    });

    if (result) {
      setComposedResult(prev => ({ 
        ...prev, 
        [stepNumber]: {
          template_name: result.chosen_template_name,
          prompt: result.composed_prompt,
          summary: result.short_merge_summary
        }
      }));
      toast({ title: "Prompt composed successfully" });
    }
  };

  const handleApply = (stepNumber: number) => {
    const composed = composedResult[stepNumber];
    const isUsed = promptUsed[stepNumber];
    
    if (isUsed) {
      // Already used - don't apply again
      return;
    }
    
    if (composed?.prompt) {
      onApplyPrompt(stepNumber, composed.prompt);
      setPromptUsed(prev => ({ ...prev, [stepNumber]: true }));
      toast({ title: "Prompt applied to step" });
    }
  };

  const renderStepPanel = (stepNumber: number) => {
    const isCurrentStep = stepNumber === currentStep;
    // Lock ONLY if not the current step OR if Step 2 has references selected
    // Panel remains ALWAYS editable for current step regardless of review/running state
    // This allows users to change suggestions and re-run at any time
    const isStep2LockedByRefs = stepNumber === 2 && step2HasReferences;
    const isLocked = stepNumber !== currentStep || isStep2LockedByRefs;
    const lockReason = isStep2LockedByRefs 
      ? "Clear design references to use AI suggestions" 
      : undefined;
    const suggestions = suggestionsByStep[stepNumber] || [];
    // For Step 1, only show allowed realistic categories
    // For Step 3, only show camera-angle related categories
    const rawCategories = categoriesByStep[stepNumber] || [];
    const categories = stepNumber === 1 
      ? rawCategories.filter(cat => STEP_1_ALLOWED_CATEGORIES.includes(cat))
      : stepNumber === 2
      ? rawCategories.filter(cat => STEP_2_ALLOWED_CATEGORIES.includes(cat))
      : stepNumber === 3
      ? rawCategories.filter(cat => STEP_3_ALLOWED_CATEGORIES.includes(cat))
      : rawCategories;
    const categoryLabels = STEP_CATEGORY_LABELS[stepNumber] || {};
    const category = selectedCategory[stepNumber];
    // For Step 1, only show realistic categories
    // For Step 2, only show design-style categories
    // For Step 3, only show camera-angle categories
    const baseSuggestions = stepNumber === 1
      ? suggestions.filter(s => STEP_1_ALLOWED_CATEGORIES.includes(s.category))
      : stepNumber === 2
      ? suggestions.filter(s => STEP_2_ALLOWED_CATEGORIES.includes(s.category))
      : stepNumber === 3
      ? suggestions.filter(s => STEP_3_ALLOWED_CATEGORIES.includes(s.category))
      : suggestions;
    const filteredSuggestions = category 
      ? baseSuggestions.filter(s => s.category === category)
      : baseSuggestions;
    const selected = selectedSuggestions[stepNumber] || [];
    const composed = composedResult[stepNumber];
    const isUsed = promptUsed[stepNumber] || false;

    return (
      <div key={stepNumber} className={`space-y-3 ${isLocked ? "opacity-60 pointer-events-none" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLocked ? (
              <div className="group relative">
                <Lock className="h-4 w-4 text-muted-foreground" />
                {lockReason && (
                  <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block bg-popover text-popover-foreground text-xs p-2 rounded shadow-lg border max-w-xs">
                    {lockReason}
                  </div>
                )}
              </div>
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
            <span className="text-sm font-medium">
              Step {stepNumber}: {STEP_NAMES[stepNumber]}
            </span>
            {isCurrentStep && !isStep2LockedByRefs && (
              <Badge className="bg-primary/20 text-primary text-[10px]">Current</Badge>
            )}
            {isStep2LockedByRefs && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                <Lock className="h-2.5 w-2.5 mr-0.5" />
                Refs Active
              </Badge>
            )}
            {selected.length > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 py-0 leading-none">
                {selected.length} selected
              </Badge>
            )}
          </div>
          {!isLocked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => generateMore(stepNumber)}
              disabled={isGenerating[stepNumber]}
              className="h-7 text-xs"
            >
              {isGenerating[stepNumber] ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              More
            </Button>
          )}
        </div>

        {/* Category filters */}
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={!category ? "default" : "outline"}
            className={`cursor-pointer text-xs ${isLocked ? "cursor-not-allowed" : ""}`}
            onClick={() => !isLocked && handleCategoryChange(stepNumber, null)}
          >
            All
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat}
              variant={category === cat ? "default" : "outline"}
              className={`cursor-pointer text-xs ${isLocked ? "cursor-not-allowed" : ""}`}
              onClick={() => !isLocked && handleCategoryChange(stepNumber, cat)}
            >
              {categoryLabels[cat] || cat}
            </Badge>
          ))}
        </div>

        {/* Suggestions list - multi-select */}
        <ScrollArea className="h-32">
          {isLoading[stepNumber] ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
              <p>No suggestions yet</p>
            </div>
          ) : (
            <div className="space-y-2 pr-2">
              {filteredSuggestions.map((suggestion) => {
                const isSelected = selected.some(s => s.id === suggestion.id);
                return (
                  <button
                    key={suggestion.id}
                    onClick={() => handleToggleSuggestion(stepNumber, suggestion)}
                    disabled={isLocked}
                    className={`w-full text-left p-2 rounded-lg border transition-colors ${
                      isSelected 
                        ? "border-primary bg-primary/10" 
                        : "border-border bg-card hover:bg-accent/50"
                    } ${isLocked ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Selection indicator - fixed size */}
                      <div className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                        isSelected 
                          ? "bg-primary border-primary" 
                          : "border-muted-foreground/30"
                      }`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{suggestion.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {suggestion.prompt}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Working prompt editor + COMPOSE PROMPT - only for current step */}
        {isCurrentStep && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="space-y-2">
              <Label className="text-xs">Working Prompt (your custom requirements)</Label>
              <Textarea
                value={workingPrompt[stepNumber] || ""}
                onChange={(e) => {
                  setWorkingPrompt(prev => ({ ...prev, [stepNumber]: e.target.value }));
                  setComposedResult(prev => ({ ...prev, [stepNumber]: null }));
                }}
                placeholder="Add your own requirements, style preferences, or specific instructions..."
                className="text-xs min-h-[80px]"
              />
            </div>
            
            <Button
              size="sm"
              onClick={() => handleComposePrompt(stepNumber)}
              disabled={isComposing || (selected.length === 0 && !(workingPrompt[stepNumber]?.trim()))}
              className="w-full"
            >
              {isComposing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3 mr-1" />
              )}
              COMPOSE PROMPT
            </Button>

            {composed && (
              <div className={`space-y-3 p-3 rounded-lg border transition-opacity ${
                isUsed 
                  ? "bg-muted/50 border-muted opacity-60" 
                  : "bg-primary/5 border-primary/20"
              }`}>
                <div className="flex items-center gap-2 text-xs">
                  <FileText className={`h-3 w-3 ${isUsed ? "text-muted-foreground" : "text-primary"}`} />
                  <span className={`font-medium ${isUsed ? "text-muted-foreground" : "text-primary"}`}>
                    {composed.template_name}
                  </span>
                  {isUsed && (
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      <Lock className="h-2.5 w-2.5 mr-1" />
                      Applied
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground italic">{composed.summary}</p>
                <div className="mt-2">
                  <Label className={`text-xs font-semibold ${isUsed ? "text-muted-foreground" : "text-primary"}`}>
                    Final Composed Prompt (Read-Only)
                  </Label>
                  <Textarea
                    value={composed.prompt}
                    readOnly
                    className={`mt-1 text-xs min-h-[120px] border-border cursor-default focus:ring-0 ${
                      isUsed ? "bg-muted/30 text-muted-foreground" : "bg-background"
                    }`}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => handleApply(stepNumber)}
                  disabled={isUsed}
                  className={`w-full ${isUsed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {isUsed ? (
                    <>
                      <Lock className="h-3 w-3 mr-1" />
                      Prompt Applied
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Use This Prompt
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Global lock for review or running state
  // Exception: Steps 3 & 4 in REJECTED state are unlocked for angle/view correction
  const canEditAfterReject = isStepRejected && (currentStep === 3 || currentStep === 4);
  const isGloballyLocked = (isInReview && !canEditAfterReject) || isStepRunning;
  
  return (
    <div className={className}>
      {/* Running lock indicator */}
      {isStepRunning && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span className="text-xs">Locked while a step is running.</span>
        </div>
      )}
      {/* Review lock indicator - only show when truly locked */}
      {isInReview && !isStepRunning && !canEditAfterReject && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span className="text-xs">Locked during review. Approve or Reject to continue.</span>
        </div>
      )}
      {/* Rejected state - unlocked for correction */}
      {isStepRejected && canEditAfterReject && !isStepRunning && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          <span className="text-xs">QA rejected. Select a different angle or view and retry.</span>
        </div>
      )}
      <div className={`space-y-6 ${isGloballyLocked ? "opacity-60 pointer-events-none" : ""}`}>
        {[1, 2, 3, 4].map(stepNumber => (
          <div key={stepNumber} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            {renderStepPanel(stepNumber)}
          </div>
        ))}
      </div>
    </div>
  );
}

export const PipelineSuggestionsPanel = memo(PipelineSuggestionsPanelComponent);
