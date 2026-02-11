/**
 * Camera Intent Selector - Step 3 (spec)
 * NEW implementation using Templates A-H
 * Decision-only layer (no rendering, no QA)
 *
 * Authority: RETOUR – PIPELINE (UPDATED & LOCKED).txt
 * Date: 2026-02-10
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera, Check, Info, AlertCircle } from 'lucide-react';
import { CAMERA_TEMPLATES, type CameraTemplateId, buildIntentDescription } from '@/lib/camera-intent-templates';
import { useToast } from '@/hooks/use-toast';

interface Space {
  id: string;
  name: string;
  space_type: string;
  adjacentSpaces?: Array<{ id: string; name: string }>;
}

interface CameraIntentSelectorProps {
  pipelineId: string;
  spaces: Space[];
  existingIntents?: Array<{
    standing_space_id: string;
    template_id: CameraTemplateId;
    target_space_id?: string;
  }>;
  onConfirm: () => void;
  isConfirming?: boolean;
  disabled?: boolean;
}

interface IntentSelection {
  templateId: CameraTemplateId;
  targetSpaceId?: string;
}

export function CameraIntentSelector({
  pipelineId,
  spaces,
  existingIntents = [],
  onConfirm,
  isConfirming = false,
  disabled = false,
}: CameraIntentSelectorProps) {
  const { toast } = useToast();

  // Initialize from existing intents if provided
  const initialSelections = new Map<string, IntentSelection>(
    existingIntents.map(intent => [
      intent.standing_space_id,
      {
        templateId: intent.template_id,
        targetSpaceId: intent.target_space_id,
      }
    ])
  );

  const [selectedIntents, setSelectedIntents] = useState<Map<string, IntentSelection>>(initialSelections);
  const [isSaving, setIsSaving] = useState(false);

  const handleTemplateSelect = (spaceId: string, templateId: CameraTemplateId) => {
    setSelectedIntents(prev => {
      const newMap = new Map(prev);
      newMap.set(spaceId, {
        templateId,
        targetSpaceId: undefined, // Reset target space when template changes
      });
      return newMap;
    });
  };

  const handleTargetSpaceSelect = (spaceId: string, targetSpaceId: string) => {
    setSelectedIntents(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(spaceId);
      if (existing) {
        newMap.set(spaceId, { ...existing, targetSpaceId });
      }
      return newMap;
    });
  };

  const handleRemoveIntent = (spaceId: string) => {
    setSelectedIntents(prev => {
      const newMap = new Map(prev);
      newMap.delete(spaceId);
      return newMap;
    });
  };

  const validateIntents = (): { valid: boolean; message?: string } => {
    if (selectedIntents.size === 0) {
      return { valid: false, message: 'Select at least one camera template for a space' };
    }

    // Validate that templates requiring adjacent spaces have target selected
    for (const [spaceId, intent] of selectedIntents.entries()) {
      const template = CAMERA_TEMPLATES[intent.templateId];
      if (template.requiresAdjacentSpace && !intent.targetSpaceId) {
        const space = spaces.find(s => s.id === spaceId);
        return {
          valid: false,
          message: `Template ${intent.templateId} for "${space?.name}" requires selecting an adjacent space`
        };
      }
    }

    return { valid: true };
  };

  const handleConfirm = async () => {
    const validation = validateIntents();
    if (!validation.valid) {
      toast({
        title: 'Validation Error',
        description: validation.message,
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);

    try {
      // Build intents array
      const intents = Array.from(selectedIntents.entries()).map(([spaceId, intent]) => {
        const space = spaces.find(s => s.id === spaceId)!;
        const template = CAMERA_TEMPLATES[intent.templateId];
        const targetSpace = intent.targetSpaceId
          ? spaces.find(s => s.id === intent.targetSpaceId)
          : undefined;

        return {
          pipeline_id: pipelineId,
          standing_space_id: spaceId,
          standing_space_name: space.name,
          template_id: intent.templateId,
          template_description: template.description,
          view_direction_type: template.viewDirectionType,
          target_space_id: intent.targetSpaceId || null,
          target_space_name: targetSpace?.name || null,
          intent_description: buildIntentDescription(
            template,
            space.name,
            space.space_type,
            targetSpace?.name
          ),
          is_selected: true,
        };
      });

      // Get auth token for edge function call
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || '';

      // Call save-camera-intents edge function
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/functions/v1/save-camera-intents', {
        method: 'POST',
        headers,
        body: JSON.stringify({ pipeline_id: pipelineId, intents }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save camera intents');
      }

      const result = await response.json();

      toast({
        title: 'Camera Intents Saved',
        description: `${result.intents_saved} camera intent(s) saved successfully`,
      });

      onConfirm();
    } catch (error) {
      console.error('[CameraIntentSelector] Error saving intents:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save camera intents',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const spacesWithIntents = spaces.filter(space => selectedIntents.has(space.id));
  const spacesWithoutIntents = spaces.filter(space => !selectedIntents.has(space.id));

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            <CardTitle>Step 3: Camera Intent</CardTitle>
            <Badge variant="outline" className="text-xs">
              Decision-Only
            </Badge>
          </div>
          {selectedIntents.size > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Check className="w-3 h-3" />
              {selectedIntents.size} space{selectedIntents.size !== 1 ? 's' : ''} configured
            </Badge>
          )}
        </div>
        <CardDescription>
          Select camera templates (A–H) for each space. No rendering or QA happens here.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Explanatory alert */}
        <Alert>
          <Info className="w-4 h-4" />
          <AlertDescription className="text-sm">
            <strong>What Step 3 Does:</strong> Define camera positions using Templates A–H.
            Bind each template to a specific space. This is a decision-only layer – no images
            are generated at this step.
          </AlertDescription>
        </Alert>

        {/* Configured spaces */}
        {spacesWithIntents.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Configured Spaces</h4>
            {spacesWithIntents.map(space => {
              const intent = selectedIntents.get(space.id)!;
              const template = CAMERA_TEMPLATES[intent.templateId];
              const targetSpace = intent.targetSpaceId
                ? spaces.find(s => s.id === intent.targetSpaceId)
                : undefined;

              return (
                <Card key={space.id} className="border-green-200 dark:border-green-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{space.name}</p>
                        <p className="text-xs text-muted-foreground">{space.space_type}</p>
                      </div>
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Template {intent.templateId}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Template:</span>
                        <span className="text-sm text-muted-foreground">
                          {template.name} - {template.description}
                        </span>
                      </div>
                      {targetSpace && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Target:</span>
                          <span className="text-sm text-muted-foreground">
                            {targetSpace.name}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveIntent(space.id)}
                      disabled={disabled || isSaving}
                    >
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Unconfigured spaces */}
        {spacesWithoutIntents.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              Available Spaces ({spacesWithoutIntents.length})
            </h4>
            {spacesWithoutIntents.map(space => {
              const intent = selectedIntents.get(space.id);
              const template = intent ? CAMERA_TEMPLATES[intent.templateId] : null;

              return (
                <Card key={space.id}>
                  <CardHeader className="pb-3">
                    <div>
                      <p className="font-medium">{space.name}</p>
                      <p className="text-xs text-muted-foreground">{space.space_type}</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div>
                      <label className="text-sm font-medium block mb-1">
                        Camera Template
                      </label>
                      <Select
                        value={intent?.templateId}
                        onValueChange={(value) => handleTemplateSelect(space.id, value as CameraTemplateId)}
                        disabled={disabled || isSaving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select template A–H" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CAMERA_TEMPLATES).map(([id, tmpl]) => (
                            <SelectItem key={id} value={id}>
                              {id} - {tmpl.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {template && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {template.description}
                        </p>
                      )}
                    </div>

                    {template?.requiresAdjacentSpace && (
                      <div>
                        <label className="text-sm font-medium block mb-1 flex items-center gap-1">
                          Target Adjacent Space
                          <AlertCircle className="w-3 h-3 text-yellow-600" />
                        </label>
                        <Select
                          value={intent?.targetSpaceId}
                          onValueChange={(value) => handleTargetSpaceSelect(space.id, value)}
                          disabled={disabled || isSaving}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select adjacent space" />
                          </SelectTrigger>
                          <SelectContent>
                            {(space.adjacentSpaces && space.adjacentSpaces.length > 0) ? (
                              space.adjacentSpaces.map(adj => (
                                <SelectItem key={adj.id} value={adj.id}>
                                  {adj.name}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="none" disabled>
                                No adjacent spaces detected
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                          Template {template.id} requires selecting an adjacent space
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Confirm button */}
        <div className="pt-4 border-t">
          <Button
            onClick={handleConfirm}
            disabled={disabled || isSaving || selectedIntents.size === 0}
            className="w-full"
            size="lg"
          >
            {isSaving ? (
              <>Saving Camera Intents...</>
            ) : (
              <>Confirm Camera Intents ({selectedIntents.size} space{selectedIntents.size !== 1 ? 's' : ''})</>
            )}
          </Button>
          {selectedIntents.size === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Select at least one camera template to proceed
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
