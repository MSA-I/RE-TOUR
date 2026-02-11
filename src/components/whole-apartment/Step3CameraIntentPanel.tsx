import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Camera, Info, CheckCircle2 } from "lucide-react";
import { CameraIntentSelector } from "./CameraIntentSelector";
import type { CameraTemplateId } from "@/lib/camera-intent-templates";

/**
 * Step 3: Camera Intent (Decision-Only Layer)
 *
 * Authoritative spec (RETOUR – PIPELINE UPDATED & LOCKED):
 * - Use Camera Position Templates A–H
 * - Bind each template to a specific space
 * - Define human eye-level position and view direction
 * - No rendering, no design, no QA here
 *
 * This component makes Step 3 visible as an active decision-only layer.
 * The actual template selection UI is delegated to CameraIntentSelector (Templates A-H).
 */

interface Step3CameraIntentPanelProps {
  pipelineId: string;
  step2UploadId: string | null;
  spaces: Array<{
    id: string;
    name: string;
    space_type: string;
  }>;
  existingIntents?: Array<{
    standing_space_id: string;
    template_id: CameraTemplateId;
    target_space_id?: string;
  }>;
  onConfirm: () => void;
  isConfirming: boolean;
  disabled?: boolean;
  cameraMarkersCount: number;
  spacesCount: number;
}

export const Step3CameraIntentPanel = memo(function Step3CameraIntentPanel({
  pipelineId,
  step2UploadId,
  spaces,
  existingIntents,
  onConfirm,
  isConfirming,
  disabled,
  cameraMarkersCount,
  spacesCount,
}: Step3CameraIntentPanelProps) {

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            <CardTitle>Step 3: Camera Intent</CardTitle>
            <Badge variant="outline" className="text-xs">
              Decision-Only Layer
            </Badge>
          </div>
          {cameraMarkersCount > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {cameraMarkersCount} camera{cameraMarkersCount !== 1 ? 's' : ''} placed
            </Badge>
          )}
        </div>
        <CardDescription>
          Define camera positions using Templates A–H. Bind each template to a specific space and set viewing direction.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Explanatory alert about what Step 3 is */}
        <Alert>
          <Info className="w-4 h-4" />
          <AlertDescription className="text-sm space-y-2">
            <p className="font-medium">What Step 3 Does:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Use Camera Position Templates A–H as conceptual framework</li>
              <li>Place camera markers at human eye-level (1.5-1.7m)</li>
              <li>Define standing point and viewing direction for each camera</li>
              <li>Bind camera intents to specific spaces</li>
            </ul>
            <p className="text-muted-foreground italic mt-2">
              Step 3 is a decision-only layer. No rendering or QA happens here.
            </p>
          </AlertDescription>
        </Alert>

        {/* Camera Intent Selector (Templates A-H, decision-only) */}
        <CameraIntentSelector
          pipelineId={pipelineId}
          spaces={spaces}
          existingIntents={existingIntents}
          onConfirm={onConfirm}
          isConfirming={isConfirming}
          disabled={disabled}
        />

        {/* Status summary */}
        {spacesCount > 0 && (
          <div className="text-sm text-muted-foreground">
            <p>
              {cameraMarkersCount} camera position{cameraMarkersCount !== 1 ? 's' : ''} defined for {spacesCount} space{spacesCount !== 1 ? 's' : ''}.
              {cameraMarkersCount === 0 && (
                <span className="text-yellow-600 dark:text-yellow-500 ml-1">
                  Place at least one camera to proceed.
                </span>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
