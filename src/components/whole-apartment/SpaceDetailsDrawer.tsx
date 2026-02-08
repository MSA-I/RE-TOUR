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
import { useStorage } from "@/hooks/useStorage";
import {
  PipelineSpace,
  SpaceRender,
  SpacePanorama,
  SpaceFinal360,
} from "@/hooks/useWholeApartmentPipeline";
import {
  Box,
  Camera,
  Grid3X3,
  GitMerge,
  Eye,
  FileText,
  AlertTriangle,
  History,
  Settings2,
  Lock,
} from "lucide-react";

interface SpaceDetailsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: PipelineSpace;
  pipelineRatio: string;
  pipelineQuality: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  planned: "bg-muted text-muted-foreground",
  generating: "bg-blue-500/20 text-blue-400",
  needs_review: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  failed: "bg-destructive/20 text-destructive",
  rejected: "bg-destructive/20 text-destructive",
};

function AssetDetailCard({
  title,
  asset,
  icon,
}: {
  title: string;
  asset: SpaceRender | SpacePanorama | SpaceFinal360 | null | undefined;
  icon: React.ReactNode;
}) {
  const { getSignedViewUrl } = useStorage();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (!asset?.output_upload_id) return;
    setLoading(true);
    try {
      const result = await getSignedViewUrl("outputs", asset.output_upload_id);
      if (result.signedUrl) {
        setPreviewUrl(result.signedUrl);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!asset) {
    return (
      <div className="p-3 rounded-lg border border-dashed border-border/50 bg-muted/20">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-sm">{title}</span>
          <Badge variant="outline" className="text-xs ml-auto">
            Not created
          </Badge>
        </div>
      </div>
    );
  }

  const qaReport = asset.qa_report as Record<string, unknown> | null;
  const hasQaIssues = asset.qa_status === "failed" && qaReport;

  return (
    <div className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
      {asset.locked_approved && (
        <Lock className="w-3 h-3 text-primary" />
      )}
        </div>
        <Badge className={`text-xs ${STATUS_COLORS[asset.status] || STATUS_COLORS.pending}`}>
          {asset.status.replace("_", " ")}
        </Badge>
      </div>

      {/* Preview Image */}
      {asset.output_upload_id && (
        <div className="space-y-2">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={title}
              className="w-full h-32 object-cover rounded-md"
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={loading}
              className="w-full"
            >
              <Eye className="w-4 h-4 mr-2" />
              Load Preview
            </Button>
          )}
        </div>
      )}

      {/* Prompt Text */}
      {"prompt_text" in asset && asset.prompt_text && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="w-3 h-3" />
            Prompt
          </Label>
          <p className="text-xs bg-muted/50 p-2 rounded max-h-20 overflow-y-auto">
            {asset.prompt_text}
          </p>
        </div>
      )}

      {/* Ratio & Quality */}
      {"ratio" in asset && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Ratio: {asset.ratio}</span>
          {"quality" in asset && <span>Quality: {asset.quality}</span>}
        </div>
      )}

      {/* QA Report */}
      {hasQaIssues && (
        <div className="space-y-1 p-2 rounded bg-destructive/10 border border-destructive/20">
          <Label className="text-xs font-medium flex items-center gap-1 text-destructive">
            <AlertTriangle className="w-3 h-3" />
            QA Issues
          </Label>
          {Array.isArray(qaReport?.issues) && (
            <ul className="text-xs text-muted-foreground space-y-1">
              {(qaReport.issues as { type: string; description: string }[]).slice(0, 3).map((issue, idx) => (
                <li key={idx} className="flex items-start gap-1">
                  <span className="text-destructive">•</span>
                  <span>{issue.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Attempt Info */}
      {"attempt_index" in asset && asset.attempt_index > 1 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <History className="w-3 h-3" />
          Attempt #{asset.attempt_index}
        </div>
      )}
    </div>
  );
}

export const SpaceDetailsDrawer = memo(function SpaceDetailsDrawer({
  open,
  onOpenChange,
  space,
  pipelineRatio,
  pipelineQuality,
}: SpaceDetailsDrawerProps) {
  const renderA = space.renders?.find((r) => r.kind === "A");
  const renderB = space.renders?.find((r) => r.kind === "B");
  const panoA = space.panoramas?.find((p) => p.kind === "A");
  const panoB = space.panoramas?.find((p) => p.kind === "B");
  const final360 = space.final360;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Box className="w-5 h-5 text-primary" />
            {space.name}
          </SheetTitle>
          <SheetDescription className="capitalize">
            {space.space_type.replace("_", " ")} • Confidence: {Math.round((space.confidence || 0.95) * 100)}%
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Pipeline Settings */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Pipeline Settings:</span>
            <Badge variant="outline">{pipelineRatio}</Badge>
            <Badge variant="outline">{pipelineQuality}</Badge>
          </div>

          <Separator />

          <Tabs defaultValue="renders" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="renders" className="text-xs">
                <Camera className="w-3 h-3 mr-1" />
                Renders
              </TabsTrigger>
              <TabsTrigger value="panoramas" className="text-xs">
                <Grid3X3 className="w-3 h-3 mr-1" />
                Panoramas
              </TabsTrigger>
              <TabsTrigger value="final360" className="text-xs">
                <GitMerge className="w-3 h-3 mr-1" />
                Final 360
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-280px)] mt-4">
              <TabsContent value="renders" className="space-y-3 mt-0">
                <AssetDetailCard
                  title="Render A (Central)"
                  asset={renderA}
                  icon={<Camera className="w-4 h-4 text-primary" />}
                />
                <AssetDetailCard
                  title="Render B (Opposite)"
                  asset={renderB}
                  icon={<Camera className="w-4 h-4 text-primary" />}
                />
              </TabsContent>

              <TabsContent value="panoramas" className="space-y-3 mt-0">
                <AssetDetailCard
                  title="Panorama A"
                  asset={panoA}
                  icon={<Grid3X3 className="w-4 h-4 text-primary" />}
                />
                <AssetDetailCard
                  title="Panorama B"
                  asset={panoB}
                  icon={<Grid3X3 className="w-4 h-4 text-primary" />}
                />
              </TabsContent>

              <TabsContent value="final360" className="space-y-3 mt-0">
                <AssetDetailCard
                  title="Merged 360°"
                  asset={final360}
                  icon={<GitMerge className="w-4 h-4 text-primary" />}
                />
                {space.bounds_note && (
                  <div className="p-3 rounded-lg bg-muted/30">
                    <Label className="text-xs text-muted-foreground">Bounds Note</Label>
                    <p className="text-sm mt-1">{space.bounds_note}</p>
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
