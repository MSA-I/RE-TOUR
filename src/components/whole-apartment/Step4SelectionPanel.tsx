/**
 * Step 4: Selection + Execution Interface
 *
 * This component provides a rigorous selection interface for camera intents
 * generated in Step 3. Users can:
 * 1. Review camera intent suggestions
 * 2. Select which intents to render (checkboxes)
 * 3. Generate text prompts (transform intents -> NanoBanana prompts)
 * 4. Generate images (trigger batch rendering)
 *
 * Authority: RETOUR – PIPELINE (UPDATED & LOCKED).txt Problem 2
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Camera, FileText, Image as ImageIcon, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CameraIntent {
  id: string;
  pipeline_id: string;
  standing_space_id: string;
  standing_space_name: string;
  template_id: string;
  template_description: string;
  view_direction_type: string;
  target_space_id: string | null;
  target_space_name: string | null;
  intent_description: string;
  is_selected: boolean;
}

interface Step4SelectionPanelProps {
  pipelineId: string;
  cameraIntents: CameraIntent[];
  onGeneratePrompts: (selectedIntentIds: string[]) => Promise<void>;
  onGenerateImages: () => Promise<void>;
  isGeneratingPrompts?: boolean;
  isGeneratingImages?: boolean;
  hasPrompts?: boolean;
  disabled?: boolean;
}

export function Step4SelectionPanel({
  pipelineId,
  cameraIntents,
  onGeneratePrompts,
  onGenerateImages,
  isGeneratingPrompts = false,
  isGeneratingImages = false,
  hasPrompts = false,
  disabled = false,
}: Step4SelectionPanelProps) {
  const { toast } = useToast();
  const [selectedIntentIds, setSelectedIntentIds] = useState<Set<string>>(
    new Set(cameraIntents.filter(i => i.is_selected).map(i => i.id))
  );

  const selectedCount = selectedIntentIds.size;

  const handleToggleIntent = (intentId: string) => {
    setSelectedIntentIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(intentId)) {
        newSet.delete(intentId);
      } else {
        newSet.add(intentId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIntentIds.size === cameraIntents.length) {
      setSelectedIntentIds(new Set());
    } else {
      setSelectedIntentIds(new Set(cameraIntents.map(i => i.id)));
    }
  };

  const handleGeneratePrompts = async () => {
    if (selectedCount === 0) {
      toast({
        title: 'No Intents Selected',
        description: 'Please select at least one camera intent to generate prompts.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await onGeneratePrompts(Array.from(selectedIntentIds));
      toast({
        title: 'Prompts Generated',
        description: `Generated prompts for ${selectedCount} camera intent(s).`,
      });
    } catch (error) {
      console.error('[Step4] Error generating prompts:', error);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to generate prompts',
        variant: 'destructive',
      });
    }
  };

  const handleGenerateImages = async () => {
    try {
      await onGenerateImages();
      toast({
        title: 'Image Generation Started',
        description: 'Batch rendering has been triggered.',
      });
    } catch (error) {
      console.error('[Step4] Error generating images:', error);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to start image generation',
        variant: 'destructive',
      });
    }
  };

  // Group intents by space for better organization
  const intentsBySpace = useMemo(() => {
    const groups: Record<string, CameraIntent[]> = {};
    for (const intent of cameraIntents) {
      if (!groups[intent.standing_space_name]) {
        groups[intent.standing_space_name] = [];
      }
      groups[intent.standing_space_name].push(intent);
    }
    return groups;
  }, [cameraIntents]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            <CardTitle>Step 4: Selection + Execution</CardTitle>
          </div>
          {selectedCount > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {selectedCount} selected
            </Badge>
          )}
        </div>
        <CardDescription>
          Select camera intents to render and generate prompts for image generation.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Explanatory alert */}
        <Alert>
          <Info className="w-4 h-4" />
          <AlertDescription className="text-sm">
            <strong>What Step 4 Does:</strong> Review camera intents from Step 3, select which ones to render,
            generate NanoBanana prompts, and trigger batch image generation.
          </AlertDescription>
        </Alert>

        {/* No intents available */}
        {cameraIntents.length === 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              No camera intents available. Please complete Step 3 first.
            </AlertDescription>
          </Alert>
        )}

        {/* Selection controls */}
        {cameraIntents.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={disabled}
              >
                {selectedIntentIds.size === cameraIntents.length ? 'Deselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedCount} of {cameraIntents.length} intent(s) selected
              </span>
            </div>

            {/* Camera intents list grouped by space */}
            <div className="space-y-3">
              {Object.entries(intentsBySpace).map(([spaceName, intents]) => (
                <Card key={spaceName} className="border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{spaceName}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {intents.map(intent => {
                      const isSelected = selectedIntentIds.has(intent.id);
                      return (
                        <div
                          key={intent.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border ${
                            isSelected ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleIntent(intent.id)}
                            disabled={disabled}
                            className="mt-0.5"
                          />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                Template {intent.template_id}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {intent.view_direction_type}
                              </span>
                            </div>
                            <p className="text-sm">{intent.intent_description}</p>
                            {intent.target_space_name && (
                              <p className="text-xs text-muted-foreground">
                                Target: {intent.target_space_name}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Action buttons */}
            <div className="pt-4 border-t space-y-3">
              {/* Generate Prompts button */}
              <Button
                onClick={handleGeneratePrompts}
                disabled={disabled || isGeneratingPrompts || selectedCount === 0 || hasPrompts}
                className="w-full"
                size="lg"
                variant={hasPrompts ? 'outline' : 'default'}
              >
                {isGeneratingPrompts ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Prompts...
                  </>
                ) : hasPrompts ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Prompts Generated
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Prompts ({selectedCount})
                  </>
                )}
              </Button>

              {/* Generate Images button - only appears after prompts are ready */}
              {hasPrompts && (
                <Button
                  onClick={handleGenerateImages}
                  disabled={disabled || isGeneratingImages}
                  className="w-full"
                  size="lg"
                >
                  {isGeneratingImages ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating Images...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Generate Images
                    </>
                  )}
                </Button>
              )}

              {!hasPrompts && selectedCount === 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Select at least one camera intent to generate prompts
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
