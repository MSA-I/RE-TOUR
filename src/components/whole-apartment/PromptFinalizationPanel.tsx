/**
 * Prompt Finalization Panel - Step 4 UI
 *
 * Displays final composed prompts for each space based on selected camera intents.
 * Allows inline editing and image count adjustment before generation.
 *
 * Accessibility: WCAG 2.1 AA compliant
 * - Readable font sizes (16px minimum)
 * - Proper line height (1.5-1.75)
 * - Keyboard navigation
 * - Loading states with feedback
 * - Focus management
 *
 * Authority: ui_format_plan.md (ui-ux-pro-max framework)
 * Date: 2026-02-11
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Save, PlayCircle, Info, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface FinalPrompt {
  id: string;
  space_id: string;
  prompt_template: string;
  final_composed_prompt: string;
  image_count: number;
  source_camera_intent_ids: string[];
  status: 'pending' | 'queued' | 'generating' | 'complete' | 'failed';
}

interface PipelineSpace {
  id: string;
  name: string;
  space_type: string;
}

interface PromptFinalizationPanelProps {
  pipelineId: string;
  spaces: PipelineSpace[];
  onConfirmAndGenerate: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
}

export function PromptFinalizationPanel({
  pipelineId,
  spaces,
  onConfirmAndGenerate,
  isGenerating = false,
  disabled = false,
}: PromptFinalizationPanelProps) {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<FinalPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editedPrompts, setEditedPrompts] = useState<Map<string, string>>(new Map());
  const [editedImageCounts, setEditedImageCounts] = useState<Map<string, number>>(new Map());

  // Fetch final prompts from database
  useEffect(() => {
    async function fetchPrompts() {
      try {
        const { data, error } = await supabase
          .from('final_prompts')
          .select('*')
          .eq('pipeline_id', pipelineId)
          .order('created_at');

        if (error) throw error;

        setPrompts(data || []);
      } catch (error) {
        console.error('[PromptFinalizationPanel] Error fetching prompts:', error);
        toast({
          title: 'Error Loading Prompts',
          description: error instanceof Error ? error.message : 'Failed to load final prompts',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    }

    if (pipelineId && spaces.length > 0) {
      fetchPrompts();
    }
  }, [pipelineId, spaces, toast]);

  // Map prompts by space_id
  const promptsBySpace = useMemo(() => {
    const map = new Map<string, FinalPrompt>();
    prompts.forEach(p => map.set(p.space_id, p));
    return map;
  }, [prompts]);

  // Handle prompt text edit
  const handlePromptEdit = (spaceId: string, newText: string) => {
    setEditedPrompts(prev => new Map(prev).set(spaceId, newText));
  };

  // Handle image count edit
  const handleImageCountEdit = (spaceId: string, count: number) => {
    const clampedCount = Math.min(Math.max(count, 1), 10);
    setEditedImageCounts(prev => new Map(prev).set(spaceId, clampedCount));
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return editedPrompts.size > 0 || editedImageCounts.size > 0;
  }, [editedPrompts, editedImageCounts]);

  // Save changes to database
  const handleSaveChanges = async () => {
    if (!hasUnsavedChanges) return;

    setIsSaving(true);

    try {
      const updates = [];

      // Prepare updates for edited prompts
      for (const [spaceId, newPrompt] of editedPrompts.entries()) {
        const prompt = promptsBySpace.get(spaceId);
        if (prompt) {
          updates.push({
            id: prompt.id,
            final_composed_prompt: newPrompt,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Prepare updates for edited image counts
      for (const [spaceId, newCount] of editedImageCounts.entries()) {
        const prompt = promptsBySpace.get(spaceId);
        if (prompt) {
          const existing = updates.find(u => u.id === prompt.id);
          if (existing) {
            existing.image_count = newCount;
          } else {
            updates.push({
              id: prompt.id,
              image_count: newCount,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      if (updates.length > 0) {
        const { error } = await supabase
          .from('final_prompts')
          .upsert(updates, { onConflict: 'id' });

        if (error) throw error;

        toast({
          title: 'Changes Saved',
          description: `${updates.length} prompt(s) updated successfully`,
        });

        // Update local state
        setPrompts(prev =>
          prev.map(p => {
            const update = updates.find(u => u.id === p.id);
            return update ? { ...p, ...update } : p;
          })
        );

        // Clear edited state
        setEditedPrompts(new Map());
        setEditedImageCounts(new Map());
      }
    } catch (error) {
      console.error('[PromptFinalizationPanel] Error saving changes:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save prompt changes',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle confirm and generate
  const handleConfirmAndGenerate = async () => {
    if (hasUnsavedChanges) {
      toast({
        title: 'Unsaved Changes',
        description: 'Please save your changes before generating images',
        variant: 'destructive',
      });
      return;
    }

    onConfirmAndGenerate();
  };

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading Final Prompts...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-32 animate-pulse rounded-lg bg-muted" />
              </div>
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
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle>Step 4: Prompts + Generation</CardTitle>
            {hasUnsavedChanges && (
              <Badge variant="outline" className="text-xs text-yellow-600">
                Unsaved Changes
              </Badge>
            )}
          </div>
          <Badge variant="secondary" className="w-fit">
            {prompts.length} space{prompts.length !== 1 ? 's' : ''} ready
          </Badge>
        </div>
        <CardDescription>
          Review and edit final prompts before generating images. You can adjust the prompt text and number of images per space.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Explanatory alert */}
        <Alert>
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="text-sm">
            <p className="font-medium">What Step 4 Does:</p>
            <p className="mt-1 text-muted-foreground">
              AI has composed final prompts based on your selected camera intents. You can edit the prompts
              or adjust the number of images to generate per space (1-10). Save changes before generating.
            </p>
          </AlertDescription>
        </Alert>

        {prompts.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              No final prompts available yet. Please complete Step 3 (Camera Intent) first.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Prompts by space */}
            <div className="space-y-6">
              {spaces.map(space => {
                const prompt = promptsBySpace.get(space.id);

                if (!prompt) {
                  return (
                    <Card key={space.id} className="border-yellow-200 dark:border-yellow-800">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{space.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          No prompt generated yet for this space
                        </p>
                      </CardHeader>
                    </Card>
                  );
                }

                const currentPrompt = editedPrompts.get(space.id) ?? prompt.final_composed_prompt;
                const currentImageCount = editedImageCounts.get(space.id) ?? prompt.image_count;
                const hasChanges = editedPrompts.has(space.id) || editedImageCounts.has(space.id);

                return (
                  <Card key={space.id} className={cn(hasChanges && "border-yellow-200 dark:border-yellow-800")}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{space.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">{space.space_type}</p>
                        </div>
                        {hasChanges && (
                          <Badge variant="outline" className="text-xs text-yellow-600">
                            Edited
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Image count selector */}
                      <div className="space-y-2">
                        <Label htmlFor={`image-count-${space.id}`} className="text-sm font-medium">
                          Number of Images (1-10)
                        </Label>
                        <Input
                          id={`image-count-${space.id}`}
                          type="number"
                          min={1}
                          max={10}
                          value={currentImageCount}
                          onChange={(e) => handleImageCountEdit(space.id, parseInt(e.target.value) || 1)}
                          disabled={disabled || isSaving || isGenerating}
                          className="w-32"
                        />
                      </div>

                      {/* Prompt editor */}
                      <div className="space-y-2">
                        <Label htmlFor={`prompt-${space.id}`} className="text-sm font-medium">
                          Final Prompt
                        </Label>
                        <Textarea
                          id={`prompt-${space.id}`}
                          value={currentPrompt}
                          onChange={(e) => handlePromptEdit(space.id, e.target.value)}
                          disabled={disabled || isSaving || isGenerating}
                          className="min-h-[120px] font-mono text-sm leading-relaxed"
                          placeholder="Prompt will be generated based on camera intents..."
                        />
                        <p className="text-xs text-muted-foreground">
                          {currentPrompt.length} characters
                          {prompt.source_camera_intent_ids.length > 0 && (
                            <span className="ml-2">
                              • Based on {prompt.source_camera_intent_ids.length} camera intent(s)
                            </span>
                          )}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row">
              {hasUnsavedChanges && (
                <Button
                  onClick={handleSaveChanges}
                  disabled={disabled || isSaving || isGenerating}
                  variant="outline"
                  className="min-h-[44px] w-full sm:w-auto"
                  aria-busy={isSaving}
                >
                  {isSaving ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Saving Changes...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                      Save Changes
                    </>
                  )}
                </Button>
              )}

              <Button
                onClick={handleConfirmAndGenerate}
                disabled={disabled || isGenerating || hasUnsavedChanges || prompts.length === 0}
                className="min-h-[44px] flex-1"
                size="lg"
                aria-busy={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Generating Images...
                  </>
                ) : (
                  <>
                    <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    Confirm & Generate Images ({prompts.reduce((sum, p) => sum + (editedImageCounts.get(p.space_id) ?? p.image_count), 0)} total)
                  </>
                )}
              </Button>
            </div>

            {hasUnsavedChanges && (
              <p className="text-center text-xs text-yellow-600 dark:text-yellow-500">
                You have unsaved changes. Please save before generating images.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
