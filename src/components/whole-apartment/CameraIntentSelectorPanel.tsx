/**
 * Camera Intent Selector Panel - Step 3 UI Redesign
 *
 * BREAKING CHANGE: Step 3 no longer shows camera placement tools.
 * Users select from AI-generated prompt suggestions instead.
 *
 * Accessibility: WCAG 2.1 AA compliant
 * - 44x44px touch targets on mobile
 * - 4.5:1 color contrast minimum
 * - Keyboard navigation (Tab, Space)
 * - Screen reader support with ARIA
 * - Focus states visible
 *
 * Authority: ui_format_plan.md (ui-ux-pro-max framework)
 * Date: 2026-02-11
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface CameraIntentSuggestion {
  id: string;
  space_id: string;
  suggestion_text: string;
  suggestion_index: number;
  is_selected: boolean;
  space_size_category: 'large' | 'normal';
}

interface PipelineSpace {
  id: string;
  name: string;
  space_type: string;
  detected_size_category?: string;
}

interface CameraIntentSelectorPanelProps {
  pipelineId: string;
  spaces: PipelineSpace[];
  onConfirm: () => void;
  isConfirming?: boolean;
  disabled?: boolean;
}

export function CameraIntentSelectorPanel({
  pipelineId,
  spaces,
  onConfirm,
  isConfirming = false,
  disabled = false,
}: CameraIntentSelectorPanelProps) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<CameraIntentSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Fetch camera intent suggestions from database (auto-generate if empty)
  useEffect(() => {
    async function fetchOrGenerateSuggestions() {
      try {
        // First, try to fetch existing suggestions
        const { data, error } = await supabase
          .from('camera_intents')
          .select('*')
          .eq('pipeline_id', pipelineId)
          .order('space_id')
          .order('suggestion_index');

        if (error) throw error;

        // If no suggestions exist, generate them automatically
        if (!data || data.length === 0) {
          console.log('[CameraIntentSelectorPanel] No suggestions found - generating...');

          const { error: generateError } = await supabase.functions.invoke('save-camera-intents', {
            body: { pipeline_id: pipelineId }
          });

          if (generateError) {
            console.error('[CameraIntentSelectorPanel] Generation failed:', generateError);
            throw generateError;
          }

          // Fetch again after generation
          const { data: newData, error: refetchError } = await supabase
            .from('camera_intents')
            .select('*')
            .eq('pipeline_id', pipelineId)
            .order('space_id')
            .order('suggestion_index');

          if (refetchError) throw refetchError;

          setSuggestions(newData || []);

          toast({
            title: 'Suggestions Generated',
            description: `${newData?.length || 0} camera intent suggestions created`,
          });
        } else {
          setSuggestions(data);
        }
      } catch (error) {
        console.error('[CameraIntentSelectorPanel] Error fetching suggestions:', error);
        toast({
          title: 'Error Loading Suggestions',
          description: error instanceof Error ? error.message : 'Failed to load camera intent suggestions',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    }

    if (pipelineId && spaces.length > 0) {
      fetchOrGenerateSuggestions();
    }
  }, [pipelineId, spaces, toast]);

  // Group suggestions by space
  const suggestionsBySpace = useMemo(() => {
    const grouped = new Map<string, CameraIntentSuggestion[]>();

    spaces.forEach(space => {
      const spaceSuggestions = suggestions.filter(s => s.space_id === space.id);
      grouped.set(space.id, spaceSuggestions);
    });

    return grouped;
  }, [spaces, suggestions]);

  // Handle checkbox toggle
  const handleToggleSuggestion = (suggestionId: string, selected: boolean) => {
    setSuggestions(prev =>
      prev.map(s => (s.id === suggestionId ? { ...s, is_selected: selected } : s))
    );

    // Clear validation error for this space when user makes a selection
    const suggestion = suggestions.find(s => s.id === suggestionId);
    if (suggestion && selected) {
      setValidationErrors(prev => {
        const { [suggestion.space_id]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  // Validate: at least 1 selection per space
  const validateSelections = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    spaces.forEach(space => {
      const spaceSuggestions = suggestionsBySpace.get(space.id) || [];
      const hasSelection = spaceSuggestions.some(s => s.is_selected);

      if (!hasSelection && spaceSuggestions.length > 0) {
        errors[space.id] = `Please select at least one camera intent for ${space.name}`;
      }
    });

    return errors;
  };

  // Handle confirm button
  const handleConfirm = async () => {
    const errors = validateSelections();

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);

      // Announce error to screen readers
      toast({
        title: 'Validation Error',
        description: 'Please select at least one camera intent for each space',
        variant: 'destructive',
      });

      return;
    }

    setIsSaving(true);

    try {
      // Update selections in database
      const updates = suggestions.map(s => ({
        id: s.id,
        is_selected: s.is_selected,
        selected_at: s.is_selected ? new Date().toISOString() : null,
      }));

      const { error } = await supabase
        .from('camera_intents')
        .upsert(updates, { onConflict: 'id' });

      if (error) throw error;

      toast({
        title: 'Camera Intents Saved',
        description: `${suggestions.filter(s => s.is_selected).length} selection(s) saved successfully`,
      });

      onConfirm();
    } catch (error) {
      console.error('[CameraIntentSelectorPanel] Error saving selections:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save camera intent selections',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate selection summary
  const selectionSummary = useMemo(() => {
    const totalSelected = suggestions.filter(s => s.is_selected).length;
    const spacesWithSelections = new Set(
      suggestions.filter(s => s.is_selected).map(s => s.space_id)
    ).size;

    return { totalSelected, spacesWithSelections };
  }, [suggestions]);

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading Camera Intent Suggestions...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle>Step 3: Camera Intent</CardTitle>
            <Badge variant="outline" className="text-xs">
              Decision-Only
            </Badge>
          </div>
          {selectionSummary.totalSelected > 0 && (
            <Badge variant="secondary" className="flex w-fit items-center gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {selectionSummary.totalSelected} selected ({selectionSummary.spacesWithSelections}/{spaces.length} spaces)
            </Badge>
          )}
        </div>
        <CardDescription>
          Select camera intent suggestions for each space. Multiple selections per space allowed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Explanatory alert */}
        <Alert>
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="text-sm">
            <p className="font-medium">What Step 3 Does:</p>
            <p className="mt-1 text-muted-foreground">
              AI has generated camera intent suggestions based on your spaces. Select the intents that
              best match your vision. You can select multiple suggestions per space. No manual camera
              placement needed.
            </p>
          </AlertDescription>
        </Alert>

        {/* Suggestions grouped by space */}
        <div className="space-y-6">
          {spaces.map(space => {
            const spaceSuggestions = suggestionsBySpace.get(space.id) || [];
            const hasError = !!validationErrors[space.id];
            const selectedCount = spaceSuggestions.filter(s => s.is_selected).length;

            return (
              <fieldset
                key={space.id}
                className={cn(
                  "rounded-lg border border-border p-4 transition-colors",
                  hasError && "border-red-500 bg-red-50 dark:bg-red-950/20"
                )}
                aria-describedby={hasError ? `error-${space.id}` : undefined}
              >
                <legend className="px-2 text-base font-medium">
                  {space.name}
                  {selectedCount > 0 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({selectedCount} selected)
                    </span>
                  )}
                </legend>

                {/* Error message - positioned near the problem (UX guideline #33) */}
                {hasError && (
                  <div
                    id={`error-${space.id}`}
                    className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span>{validationErrors[space.id]}</span>
                  </div>
                )}

                {spaceSuggestions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No camera intent suggestions generated for this space yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {spaceSuggestions.map((suggestion, idx) => {
                      const checkboxId = `suggestion-${suggestion.id}`;

                      return (
                        <div key={suggestion.id} className="flex items-start gap-3">
                          {/* Checkbox with 44x44px touch target (UX guideline #22) */}
                          <div className="flex h-11 w-11 items-center justify-center">
                            <Checkbox
                              id={checkboxId}
                              checked={suggestion.is_selected}
                              onCheckedChange={(checked) =>
                                handleToggleSuggestion(suggestion.id, checked === true)
                              }
                              disabled={disabled || isSaving}
                              className="h-5 w-5 cursor-pointer data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                              aria-describedby={`suggestion-label-${suggestion.id}`}
                            />
                          </div>

                          {/* Label with proper association (UX guideline #43) */}
                          <label
                            htmlFor={checkboxId}
                            id={`suggestion-label-${suggestion.id}`}
                            className="flex-1 cursor-pointer select-none py-2 text-sm leading-relaxed text-foreground"
                          >
                            {suggestion.suggestion_text}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>

        {/* Confirm button - disabled during loading (UX guideline #32) */}
        <div className="flex flex-col gap-2 border-t pt-4">
          <Button
            onClick={handleConfirm}
            disabled={disabled || isSaving || suggestions.length === 0}
            className="w-full min-h-[44px] text-base font-medium"
            size="lg"
            aria-busy={isSaving}
          >
            {isSaving ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Confirming Selections...
              </>
            ) : (
              <>
                Confirm Camera Intents ({selectionSummary.totalSelected} selected) →
              </>
            )}
          </Button>

          {suggestions.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              No suggestions available. Camera intents may not have been generated yet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
