import { useState, useEffect, useCallback, memo, useRef } from "react";
import { useChangeSuggestions } from "@/hooks/useChangeSuggestions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, Sparkles, Shuffle, ChevronRight, Wand2, Palette, Layers, Check, Lock, X, Edit3 } from "lucide-react";

interface ChangeSuggestion {
  id: string;
  category: string;
  title: string;
  prompt: string;
  is_generated: boolean;
  created_at: string;
}

interface ReferenceImage {
  id: string;
  original_filename: string | null;
  previewUrl?: string;
}

interface ChangeSuggestionsPanelProps {
  onSelectSuggestion: (prompt: string) => void;
  hasDesignRefs?: boolean;
  /** Enable compose prompt mode with multi-select, compose button, and use prompt action */
  enableCompose?: boolean;
  /** Callback when user applies the composed prompt */
  onApplyComposedPrompt?: (composedPrompt: string) => void;
  /** Current change request text from parent (for compose) */
  changeRequestText?: string;
  /** Whether the compose operation is in progress */
  isComposing?: boolean;
  /** Handler to trigger compose */
  onComposePrompt?: () => void;
  /** Reference images for style transfer selection */
  referenceImages?: ReferenceImage[];
  /** Callback when style transfer is applied with selected references */
  onApplyStyleTransfer?: (selectedRefIds: string[], prompt: string) => void;
}

const STYLE_TRANSFER_PROMPT = `Apply the overall style (materials, color palette, lighting mood, furniture language) from the selected reference(s) to the panorama while keeping the layout, perspective, camera angle, and all architectural elements unchanged. Preserve the room geometry exactly as it is.`;

function ChangeSuggestionsPanelComponent({ 
  onSelectSuggestion, 
  hasDesignRefs = false,
  enableCompose = false,
  onApplyComposedPrompt,
  changeRequestText = "",
  isComposing = false,
  onComposePrompt,
  referenceImages = [],
  onApplyStyleTransfer
}: ChangeSuggestionsPanelProps) {
  const {
    suggestions,
    categories,
    isLoading,
    isGenerating,
    fetchSuggestions,
    generateMore,
    getSurprise,
  } = useChangeSuggestions();

  const [mode, setMode] = useState<"edits" | "style_transfer">("edits");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Multi-select mode for compose
  const [selectedSuggestions, setSelectedSuggestions] = useState<ChangeSuggestion[]>([]);
  
  // Composed prompt state
  const [composedPrompt, setComposedPrompt] = useState<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptUsed, setPromptUsed] = useState(false);
  
  // Track if initial fetch is done to prevent duplicate calls
  const initialFetchDone = useRef(false);
  
  // Style transfer: selected reference IDs
  const [selectedStyleRefs, setSelectedStyleRefs] = useState<string[]>([]);

  // Initial fetch - only once on mount
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    fetchSuggestions();
  }, [fetchSuggestions]);

  // Handle category/search changes with debounce
  useEffect(() => {
    // Skip if this is the initial render
    if (!initialFetchDone.current) return;
    
    const debounce = setTimeout(() => {
      fetchSuggestions(selectedCategory === "all" ? undefined : selectedCategory, searchQuery || undefined);
    }, 300);
    return () => clearTimeout(debounce);
  }, [selectedCategory, searchQuery, fetchSuggestions]);

  const handleSurpriseMe = async () => {
    const suggestion = await getSurprise();
    if (suggestion) {
      if (enableCompose) {
        // In compose mode, add to selection
        handleToggleSuggestion(suggestion);
      } else {
        onSelectSuggestion(suggestion.prompt);
      }
    }
  };

  const handleStyleTransfer = () => {
    console.log("[StyleTransfer] Selected reference IDs:", selectedStyleRefs);
    
    if (selectedStyleRefs.length === 0) {
      // No refs selected - do nothing (button should be disabled, but guard anyway)
      console.warn("[StyleTransfer] No references selected");
      return;
    }
    
    if (onApplyStyleTransfer) {
      console.log("[StyleTransfer] Applying with refs:", selectedStyleRefs);
      onApplyStyleTransfer(selectedStyleRefs, STYLE_TRANSFER_PROMPT);
    } else {
      // Fallback: just insert the prompt
      onSelectSuggestion(STYLE_TRANSFER_PROMPT);
    }
  };

  const handleToggleStyleRef = (refId: string) => {
    setSelectedStyleRefs(prev => {
      if (prev.includes(refId)) {
        return prev.filter(id => id !== refId);
      }
      return [...prev, refId];
    });
  };

  const handleToggleSuggestion = (suggestion: ChangeSuggestion) => {
    setSelectedSuggestions(prev => {
      const exists = prev.find(s => s.id === suggestion.id);
      if (exists) {
        return prev.filter(s => s.id !== suggestion.id);
      }
      return [...prev, suggestion];
    });
    
    // CRITICAL FIX: Also insert/update the textarea so prompt has content
    // This ensures the Change Request textarea is populated for job creation
    onSelectSuggestion(suggestion.prompt);
    
    // Clear composed prompt when selection changes
    setComposedPrompt(null);
    setPromptUsed(false);
  };

  const handleComposeClick = async () => {
    if (onComposePrompt) {
      onComposePrompt();
    } else {
      // Fallback: merge selected suggestions with change request
      const parts: string[] = [];
      
      // Add selected suggestions
      selectedSuggestions.forEach(s => {
        parts.push(s.prompt);
      });
      
      // Add change request if present
      if (changeRequestText.trim()) {
        parts.push(changeRequestText.trim());
      }
      
      const merged = parts.join(". ").replace(/\.\./g, ".").trim();
      setComposedPrompt(merged);
    }
  };

  const handleUsePrompt = () => {
    if (composedPrompt && onApplyComposedPrompt) {
      onApplyComposedPrompt(composedPrompt);
      setPromptUsed(true);
    }
  };

  const handleClearComposed = () => {
    setComposedPrompt(null);
    setPromptUsed(false);
    setSelectedSuggestions([]);
  };

  const categoryLabels: Record<string, string> = {
    materials: "Materials",
    walls: "Walls",
    furniture: "Furniture",
    lighting: "Lighting",
    decor: "Decor",
    atmosphere: "Atmosphere",
  };

  const filteredSuggestions = suggestions.filter((s) => {
    if (selectedCategory !== "all" && s.category !== selectedCategory) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return s.title.toLowerCase().includes(query) || s.prompt.toLowerCase().includes(query);
    }
    return true;
  });

  const canCompose = enableCompose && (selectedSuggestions.length > 0 || changeRequestText.trim().length > 0);

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as "edits" | "style_transfer")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edits" className="gap-2">
            <Wand2 className="h-4 w-4" />
            Design Edits
          </TabsTrigger>
          <TabsTrigger value="style_transfer" className="gap-2">
            <Palette className="h-4 w-4" />
            Style Transfer
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "style_transfer" ? (
        /* Style Transfer Mode */
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm">Style Transfer</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Apply the visual style from your design references to the panorama while preserving its layout and geometry.
                </p>
              </div>
            </div>

            {!hasDesignRefs && (
              <div className="text-xs text-amber-500 bg-amber-500/10 rounded-md px-3 py-2">
                Upload design reference images first to use style transfer.
              </div>
            )}

            {/* Reference Image Selector */}
            {hasDesignRefs && referenceImages.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Select Style Reference(s)
                  {selectedStyleRefs.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {selectedStyleRefs.length} selected
                    </Badge>
                  )}
                </Label>
                <div className="grid grid-cols-4 gap-2 p-3 bg-background rounded-lg border">
                  {referenceImages.map((ref) => {
                    const isSelected = selectedStyleRefs.includes(ref.id);
                    return (
                      <button
                        key={ref.id}
                        onClick={() => handleToggleStyleRef(ref.id)}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected 
                            ? "border-primary ring-2 ring-primary/30" 
                            : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        {ref.previewUrl ? (
                          <img 
                            src={ref.previewUrl} 
                            alt={ref.original_filename || "Reference"} 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <Palette className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                              <Check className="h-4 w-4 text-primary-foreground" />
                            </div>
                          </div>
                        )}
                        <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 py-0.5 truncate">
                          {ref.original_filename || "Ref"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {selectedStyleRefs.length === 0 && (
                  <p className="text-xs text-amber-500">
                    Please select at least one reference image
                  </p>
                )}
              </div>
            )}

            <div className="text-xs text-muted-foreground bg-background rounded-md p-3 border">
              <p className="font-medium mb-1">What will be transferred:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/80">
                <li>Materials and textures</li>
                <li>Color palette and tones</li>
                <li>Lighting mood and atmosphere</li>
                <li>Furniture style language</li>
              </ul>
              <p className="font-medium mt-2 mb-1">What will be preserved:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/80">
                <li>Room layout and perspective</li>
                <li>Architectural elements</li>
                <li>Camera angle and position</li>
              </ul>
            </div>

            <Button 
              onClick={handleStyleTransfer} 
              className="w-full"
              disabled={!hasDesignRefs || selectedStyleRefs.length === 0}
            >
              <Palette className="h-4 w-4 mr-2" />
              Apply Style Transfer {selectedStyleRefs.length > 0 && `(${selectedStyleRefs.length} ref${selectedStyleRefs.length > 1 ? 's' : ''})`}
            </Button>
          </div>
        </div>
      ) : (
        /* Design Edits Mode */
        <>
          {/* Search and actions */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search suggestions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSurpriseMe}
              title="Surprise me!"
            >
              <Shuffle className="h-4 w-4" />
            </Button>
          </div>

          {/* Category filters */}
          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={selectedCategory === "all" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelectedCategory("all")}
            >
              All
            </Badge>
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                className="cursor-pointer capitalize"
                onClick={() => setSelectedCategory(cat)}
              >
                {categoryLabels[cat] || cat}
              </Badge>
            ))}
          </div>

          {/* Selection indicator for compose mode */}
          {enableCompose && selectedSuggestions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20">
              <Check className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{selectedSuggestions.length} suggestion(s) selected</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2"
                onClick={() => setSelectedSuggestions([])}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Suggestions list */}
          <ScrollArea className="h-[200px] border rounded-lg bg-background/50">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSuggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Sparkles className="h-8 w-8 mb-2" />
                <p className="text-sm">No suggestions found</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredSuggestions.map((suggestion) => {
                  const isSelected = enableCompose && selectedSuggestions.find(s => s.id === suggestion.id);
                  return (
                    <button
                      key={suggestion.id}
                      onClick={() => {
                        if (enableCompose) {
                          handleToggleSuggestion(suggestion);
                        } else {
                          onSelectSuggestion(suggestion.prompt);
                        }
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors group flex items-center gap-2 ${
                        isSelected 
                          ? "bg-primary/20 border border-primary/30" 
                          : "hover:bg-muted/50"
                      }`}
                    >
                      {enableCompose && (
                        <div className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${
                          isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                        }`}>
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{suggestion.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{suggestion.prompt}</p>
                      </div>
                      {!enableCompose && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Generate more */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => generateMore(selectedCategory === "all" ? undefined : selectedCategory)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Generate More Ideas
          </Button>

          {/* Compose Prompt Section (only in compose mode) */}
          {enableCompose && (
            <div className="border-t border-border/50 pt-4 space-y-4">
              {/* Compose Button */}
              <Button
                onClick={handleComposeClick}
                disabled={!canCompose || isComposing}
                variant="outline"
                className="w-full border-primary/50 hover:bg-primary/10"
              >
                {isComposing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Compose Prompt
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                AI will merge selected suggestions with your change request
              </p>

              {/* Composed Prompt Display */}
              {composedPrompt && (
                <div className={`space-y-3 p-4 rounded-lg border ${promptUsed ? "bg-muted/30 opacity-70" : "bg-muted/50"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {promptUsed ? (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                      <span className="font-medium text-sm">
                        {promptUsed ? "Prompt Applied" : "Composed Prompt Ready"}
                      </span>
                    </div>
                  </div>
                  
                  <div className="bg-background rounded-md p-3 border border-border/50">
                    {isEditingPrompt && !promptUsed ? (
                      <Textarea
                        value={composedPrompt}
                        onChange={(e) => setComposedPrompt(e.target.value)}
                        className="min-h-[100px] bg-transparent border-0 p-0 focus-visible:ring-0 resize-none"
                      />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {composedPrompt}
                      </p>
                    )}
                  </div>

                  {!promptUsed && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingPrompt(!isEditingPrompt)}
                      >
                        <Edit3 className="h-4 w-4 mr-1" />
                        {isEditingPrompt ? "Done" : "Edit"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearComposed}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Clear
                      </Button>
                    </div>
                  )}

                  {/* Use This Prompt Button */}
                  {!promptUsed && (
                    <Button
                      onClick={handleUsePrompt}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Use This Prompt
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const ChangeSuggestionsPanel = memo(ChangeSuggestionsPanelComponent);
