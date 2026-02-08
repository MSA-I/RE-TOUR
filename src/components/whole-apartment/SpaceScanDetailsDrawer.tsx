import { memo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  useSpaceScanDetails,
  SpaceScanSummary,
  CameraForSpace,
  PromptPreview,
  PromptInputImage,
} from "@/hooks/useSpaceScanDetails";
import {
  Box,
  Camera,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Eye,
  FileText,
  Compass,
  Settings2,
  Sparkles,
  MapPin,
  ArrowRight,
  User,
  Brain,
  ImageIcon,
  Link2,
} from "lucide-react";

interface SpaceScanDetailsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  spaceId: string;
}

// Camera detail card component
function CameraDetailCard({ camera }: { camera: CameraForSpace }) {
  const hasWarnings = camera.warnings.length > 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">{camera.label}</CardTitle>
            <Badge variant={camera.slot === "A" ? "default" : "secondary"} className="text-xs">
              {camera.slot === "A" ? "Primary" : "Mirror"}
            </Badge>
          </div>
          {hasWarnings ? (
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
        </div>
      </CardHeader>
      <CardContent className="py-2 px-4 space-y-3">
        {/* Position & Orientation */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Position:</span>
            <code className="bg-muted px-1 rounded">
              ({camera.x_norm.toFixed(3)}, {camera.y_norm.toFixed(3)})
            </code>
          </div>
          <div className="flex items-center gap-1.5">
            <Compass className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Yaw:</span>
            <code className="bg-muted px-1 rounded">{camera.yaw_deg}°</code>
          </div>
          <div className="flex items-center gap-1.5">
            <Eye className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">FOV:</span>
            <code className="bg-muted px-1 rounded">{camera.fov_deg}°</code>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Confidence:</span>
            <code className="bg-muted px-1 rounded">{Math.round(camera.confidence * 100)}%</code>
          </div>
        </div>

        {/* Facing Summary */}
        <div className="flex items-start gap-2">
          <Crosshair className="w-3 h-3 text-muted-foreground mt-0.5" />
          <div>
            <Label className="text-xs text-muted-foreground">Facing:</Label>
            <p className="text-sm">{camera.facing_summary}</p>
          </div>
        </div>

        {/* Prompt Hints */}
        {camera.prompt_hints.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prompt Hints:</Label>
            <ul className="text-xs space-y-0.5">
              {camera.prompt_hints.map((hint, idx) => (
                <li key={idx} className="flex items-start gap-1">
                  <ArrowRight className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {hasWarnings && (
          <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 space-y-1">
            <Label className="text-xs font-medium flex items-center gap-1 text-yellow-600">
              <AlertTriangle className="w-3 h-3" />
              Warnings
            </Label>
            <ul className="text-xs space-y-0.5 text-yellow-700">
              {camera.warnings.map((warning, idx) => (
                <li key={idx}>• {warning}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Prompt preview component - now shows input images
function PromptPreviewCard({ preview, label }: { preview: PromptPreview; label: string }) {
  const { toast } = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview.final_prompt_text);
    toast({
      title: "Copied!",
      description: "Prompt copied to clipboard",
    });
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">{label}</CardTitle>
            {preview.camera_label && (
              <Badge variant="outline" className="text-xs">{preview.camera_label}</Badge>
            )}
            <Badge variant={preview.status === "pending" ? "secondary" : "default"} className="text-xs">
              {preview.status}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-4 space-y-3">
        {/* Input Images Section */}
        {preview.input_images && preview.input_images.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />
              Input Images ({preview.input_images.length})
            </Label>
            <div className="grid gap-2">
              {preview.input_images.map((img, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 rounded bg-muted/30 border border-border/50">
                  <Link2 className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{img.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{img.description}</p>
                    {img.upload_id && (
                      <code className="text-[10px] text-muted-foreground">ID: {img.upload_id.slice(0, 8)}...</code>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">
                    {img.type.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt Text */}
        <div className="relative">
          <Label className="text-xs text-muted-foreground font-medium mb-1 block">Prompt Text:</Label>
          <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-x-auto max-h-48 whitespace-pre-wrap font-mono border border-border/50">
            {preview.final_prompt_text}
          </pre>
        </div>

        {/* Generation Params */}
        <Separator />
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground font-medium">Generation Parameters:</Label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Settings2 className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">Provider:</span>
              <Badge variant="outline" className="text-xs">{preview.provider}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Brain className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">Model:</span>
              <Badge variant="outline" className="text-xs">{preview.model}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Ratio:</span>
              <Badge variant="secondary" className="text-xs">{preview.aspect_ratio}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Quality:</span>
              <Badge variant="secondary" className="text-xs">{preview.quality}</Badge>
            </div>
          </div>
        </div>

        {/* Constraints */}
        {preview.constraints.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground font-medium">Locked Constraints:</Label>
            <ul className="text-xs space-y-0.5">
              {preview.constraints.map((constraint, idx) => (
                <li key={idx} className="flex items-start gap-1 text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                  <span>{constraint}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Empty state component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Camera className="w-12 h-12 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-xs text-muted-foreground mt-1">
        Run the camera scan to view results.
      </p>
    </div>
  );
}

export const SpaceScanDetailsDrawer = memo(function SpaceScanDetailsDrawer({
  open,
  onOpenChange,
  pipelineId,
  spaceId,
}: SpaceScanDetailsDrawerProps) {
  const { getScanSummaryForSpace, getPromptPreviewsForSpace, hasScanResults, isLoading } =
    useSpaceScanDetails(pipelineId);

  const summary = getScanSummaryForSpace(spaceId);
  const promptPreviews = getPromptPreviewsForSpace(spaceId);

  if (!summary) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Space Details</SheetTitle>
            <SheetDescription>Loading...</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const warningCount = summary.space_warnings.length;
  const cameraCount = summary.cameras.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Box className="w-5 h-5 text-primary" />
            {summary.space_name}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {summary.space_type.replace("_", " ")}
            </Badge>
            <Badge variant={summary.source === "manual" ? "default" : "secondary"}>
              {summary.source === "manual" ? (
                <>
                  <User className="w-3 h-3 mr-1" />
                  User-defined
                </>
              ) : (
                <>
                  <Brain className="w-3 h-3 mr-1" />
                  AI-detected
                </>
              )}
            </Badge>
            <span className="text-xs">
              Confidence: {Math.round(summary.confidence * 100)}%
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          <Tabs defaultValue="scan" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan" className="text-xs">
                <Camera className="w-3 h-3 mr-1" />
                Camera Scan ({cameraCount})
              </TabsTrigger>
              <TabsTrigger value="prompts" className="text-xs">
                <FileText className="w-3 h-3 mr-1" />
                Prompt Preview
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-200px)] mt-4">
              {/* Camera Scan Tab */}
              <TabsContent value="scan" className="space-y-4 mt-0">
                {/* Summary Banner */}
                <Card className={`border-l-4 ${warningCount > 0 ? "border-l-yellow-500" : "border-l-primary"}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Expected Outputs</p>
                        <p className="text-xs text-muted-foreground">{summary.expected_outputs}</p>
                      </div>
                      {warningCount > 0 && (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-500">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {warningCount} warning{warningCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Space-Level Warnings */}
                {warningCount > 0 && (
                  <Card className="border-yellow-500/30 bg-yellow-500/5">
                    <CardHeader className="py-2 px-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-yellow-600">
                        <AlertTriangle className="w-4 h-4" />
                        Space Warnings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="py-2 px-4">
                      <ul className="text-xs space-y-1 text-yellow-700">
                        {summary.space_warnings.map((warning, idx) => (
                          <li key={idx}>• {warning}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Camera List */}
                {!hasScanResults ? (
                  <EmptyState message="Camera scan not run yet" />
                ) : cameraCount === 0 ? (
                  <EmptyState message="No cameras bound to this space" />
                ) : (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Cameras Bound to This Space ({cameraCount})
                    </Label>
                    {summary.cameras.map((camera) => (
                      <CameraDetailCard key={camera.camera_id} camera={camera} />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Prompt Preview Tab */}
              <TabsContent value="prompts" className="space-y-4 mt-0">
                {!hasScanResults ? (
                  <EmptyState message="Run camera scan to generate prompt previews" />
                ) : cameraCount === 0 ? (
                  <EmptyState message="No cameras bound - no prompts to preview" />
                ) : (
                  <div className="space-y-4">
                    <Card className="border-l-4 border-l-primary">
                      <CardContent className="py-3 px-4">
                        <p className="text-sm text-muted-foreground">
                          These are the exact prompts that will be sent to NanoBanana when Step 5 (Renders) is triggered for this space.
                        </p>
                      </CardContent>
                    </Card>

                    {promptPreviews.render_a && (
                      <PromptPreviewCard
                        preview={promptPreviews.render_a}
                        label="Render A Prompt (Primary View)"
                      />
                    )}

                    {promptPreviews.render_b && (
                      <PromptPreviewCard
                        preview={promptPreviews.render_b}
                        label="Render B Prompt (Mirror View)"
                      />
                    )}

                    {!promptPreviews.render_a && !promptPreviews.render_b && (
                      <Card className="border-l-4 border-l-yellow-500 bg-yellow-500/5">
                        <CardContent className="py-4 px-4">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-yellow-700">Prompts Not Generated</p>
                              <p className="text-xs text-yellow-600 mt-1">
                                Full prompts have not been generated for this space yet. 
                                Please confirm the camera plan to generate prompts.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
});
