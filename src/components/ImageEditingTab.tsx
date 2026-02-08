import { useState, useCallback, useRef, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DropZone } from "@/components/ui/drop-zone";
import { useStorage } from "@/hooks/useStorage";
import { useUploads } from "@/hooks/useUploads";
import { useToast } from "@/hooks/use-toast";
import { usePromptComposer } from "@/hooks/usePromptComposer";
import { LazyImage } from "@/components/LazyImage";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import { ChangeSuggestionsPanel } from "@/components/ChangeSuggestionsPanel";
import { 
  Loader2, Upload, Image, Wand2, X, Paperclip, Eye
} from "lucide-react";

interface ImageAttachment {
  uploadId: string;
  filename: string;
  previewUrl?: string;
}

interface ImageEditingTabProps {
  projectId: string;
  onEditComplete?: (outputUploadId: string) => void;
  // Supports multiple attachments for batch editing
  attachedFromCreations?: ImageAttachment | ImageAttachment[] | null;
  onClearAttachment?: () => void;
  onRemoveSingleAttachment?: (uploadId: string) => void;
}


export const ImageEditingTab = memo(function ImageEditingTab({
  projectId,
  onEditComplete,
  attachedFromCreations,
  onClearAttachment,
  onRemoveSingleAttachment
}: ImageEditingTabProps) {
  // Normalize attachments to always be an array
  const attachments: ImageAttachment[] = Array.isArray(attachedFromCreations) 
    ? attachedFromCreations 
    : attachedFromCreations 
    ? [attachedFromCreations] 
    : [];
  
  const hasAttachments = attachments.length > 0;
  const isBatchMode = attachments.length > 1;
  const firstAttachment = attachments[0] || null;
  const { toast } = useToast();
  const { getSignedViewUrl } = useStorage();
  const { uploads: refImages, createUpload: createRefUpload, isLoading: refLoading } = useUploads(projectId, "design_ref");
  const { composePrompt, isComposing } = usePromptComposer();
  
  // Local detached ref IDs (refs removed from THIS editing session but not globally deleted)
  const [detachedRefIds, setDetachedRefIds] = useState<string[]>([]);
  
  // Filter refs to show only non-detached ones
  const visibleRefImages = refImages.filter(ref => !detachedRefIds.includes(ref.id));
  
  const [changeDescription, setChangeDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  
  // Pre-settings for edit job
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const [selectedQuality, setSelectedQuality] = useState("2k");
  
  // Composed prompt state
  const [composedPrompt, setComposedPrompt] = useState<string | null>(null);
  
  // Style transfer selected references
  const [styleTransferRefIds, setStyleTransferRefIds] = useState<string[]>([]);
  
  const refInputRef = useRef<HTMLInputElement>(null);

  const loadPreview = useCallback(async (uploadId: string, bucket: string, path: string) => {
    if (imagePreviews[uploadId]) return;
    
    try {
      const result = await getSignedViewUrl(bucket, path);
      if (result.signedUrl) {
        setImagePreviews(prev => ({ ...prev, [uploadId]: result.signedUrl }));
      }
    } catch (error) {
      // Silently fail
    }
  }, [getSignedViewUrl, imagePreviews]);

  const handleRefUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const maxRefs = 4;
    const currentCount = visibleRefImages.length;
    const allowedCount = maxRefs - currentCount;

    if (allowedCount <= 0) {
      toast({
        title: `Maximum ${maxRefs} reference images allowed`,
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    try {
      const filesToUpload = Array.from(files).slice(0, allowedCount);
      for (const file of filesToUpload) {
        await createRefUpload.mutateAsync({ file, kind: "design_ref" });
      }
      toast({ title: `${filesToUpload.length} reference(s) uploaded` });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  }, [refImages.length, createRefUpload, toast]);

  // FIX: Auto-fill prompt when clicking ANY suggestion (one-click = prompt populated)
  const handleApplySuggestion = useCallback((prompt: string) => {
    // Directly set the prompt, don't append - users expect one-click to populate
    setChangeDescription(prompt);
    // Clear composed prompt when change request changes
    setComposedPrompt(null);
  }, []);

  const handleComposePrompt = useCallback(async () => {
    if (!changeDescription.trim()) {
      toast({ title: "Please enter a change request first", variant: "destructive" });
      return;
    }

    try {
      const result = await composePrompt.mutateAsync({
        changeRequest: changeDescription.trim(),
        stylePrompt: undefined,
        includeStyle: false
      });

      setComposedPrompt(result.composed_prompt);
      toast({ title: "Prompt composed successfully" });
    } catch (error) {
      toast({
        title: "Failed to compose prompt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  }, [changeDescription, composePrompt, toast]);

  const handleApplyComposedPrompt = useCallback((prompt: string) => {
    setComposedPrompt(prompt);
    // Use the composed prompt as the final change description
    setChangeDescription(prompt);
    toast({ title: "Composed prompt applied" });
  }, [toast]);

  // Handle style transfer with selected references
  const handleApplyStyleTransfer = useCallback((selectedRefIds: string[], prompt: string) => {
    console.log("[ImageEdit] Style transfer with refs:", selectedRefIds);
    setStyleTransferRefIds(selectedRefIds);
    setChangeDescription(prompt);
    setComposedPrompt(null);
    toast({ 
      title: "Style transfer ready", 
      description: `Using ${selectedRefIds.length} reference image(s)` 
    });
  }, [toast]);

  // Handle detaching a reference from this session (not global delete)
  const handleDetachRef = useCallback((refId: string) => {
    console.log("[ImageEdit] Detaching ref (local only):", refId);
    setDetachedRefIds(prev => [...prev, refId]);
    // Also remove from style transfer selection if present
    setStyleTransferRefIds(prev => prev.filter(id => id !== refId));
  }, []);

  // Build reference images with preview URLs for the panel (use visibleRefImages)
  const referenceImagesWithPreviews = visibleRefImages.map(ref => ({
    id: ref.id,
    original_filename: ref.original_filename,
    previewUrl: imagePreviews[ref.id]
  }));

  // Preload reference image previews (for visible refs only)
  visibleRefImages.forEach(ref => {
    if (!imagePreviews[ref.id]) {
      loadPreview(ref.id, ref.bucket, ref.path);
    }
  });

  const handleSubmitEdit = useCallback(async () => {
    if (!hasAttachments) {
      toast({ title: "Please attach an image from Creations to edit", variant: "destructive" });
      return;
    }
    
    // Use composed prompt if available, otherwise use change description
    const finalPrompt = composedPrompt || changeDescription.trim();
    
    if (!finalPrompt) {
      toast({ title: "Please describe the changes you want", variant: "destructive" });
      return;
    }

    console.log(`[ImageEdit] Creating ${attachments.length} job(s) with ratio=${selectedRatio}, quality=${selectedQuality}`);

    setIsSubmitting(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error("Not authenticated");

      // Create edit job for each attachment (batch mode)
      for (const attachment of attachments) {
        const { data: job, error } = await supabase
          .from("image_edit_jobs")
          .insert({
            project_id: projectId,
            owner_id: user.id,
            source_upload_id: attachment.uploadId,
            change_description: finalPrompt,
            aspect_ratio: selectedRatio,
            output_quality: selectedQuality,
            status: "queued"
          })
          .select()
          .single();

        if (error) throw error;
      }

      toast({ 
        title: isBatchMode ? `${attachments.length} edit jobs created` : "Edit job created",
        description: `Ratio: ${selectedRatio}, Quality: ${selectedQuality.toUpperCase()}`
      });
      
      setChangeDescription("");
      setComposedPrompt(null);
      onClearAttachment?.();
    } catch (error) {
      toast({
        title: "Failed to create edit job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [attachments, hasAttachments, isBatchMode, changeDescription, composedPrompt, selectedRatio, selectedQuality, projectId, toast, onClearAttachment]);

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Wand2 className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Minor Image Edits</p>
              <p className="text-sm text-muted-foreground mt-1">
                Use this tab for small visual fixes, color adjustments, object removal, and lighting tweaks. 
                For full scene redesigns, use the 2D→3D Pipeline instead.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Image / Attachment */}
      <Card className={attachedFromCreations ? "border-primary/30 bg-primary/5" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            Image to Edit
          </CardTitle>
          <CardDescription>
            Attach an image from the Creations tab to edit it
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasAttachments ? (
            <div className="space-y-4">
              {/* Batch indicator */}
              {isBatchMode && (
                <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
                  <Badge variant="default" className="bg-primary">
                    Batch Edit: {attachments.length} images
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    The same edits will be applied to all images
                  </span>
                </div>
              )}
              
              {/* Thumbnails grid for all attachments */}
              <div className="flex flex-wrap gap-3">
                {attachments.map((attachment, idx) => (
                  <div key={attachment.uploadId} className="relative group">
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted border-2 border-primary/30">
                      <LazyImage
                        src={attachment.previewUrl}
                        alt={attachment.filename}
                        className="w-full h-full"
                      />
                    </div>
                    {/* Remove single attachment */}
                    {isBatchMode && onRemoveSingleAttachment && (
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onRemoveSingleAttachment(attachment.uploadId)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                    <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">
                      {attachment.filename}
                    </p>
                  </div>
                ))}
              </div>
              
              {/* Info and clear all */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    <Paperclip className="h-3 w-3 mr-1" />
                    Attached from Creations ({attachments.length})
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {isBatchMode ? "All images will be edited" : "This image will be edited"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onClearAttachment?.()}
                >
                  <X className="h-4 w-4 mr-1" />
                  {isBatchMode ? "Clear All" : "Remove"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Image className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No image attached</p>
              <p className="text-sm text-muted-foreground mt-1">
                Go to the <strong>Creations</strong> tab and select "Edit / Modify" on an image
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Suggestions - Same as Panorama Uploads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Change Suggestions
          </CardTitle>
          <CardDescription>
            Describe how you want to transform your image
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Reuse ChangeSuggestionsPanel with compose mode enabled */}
          <ChangeSuggestionsPanel
            onSelectSuggestion={handleApplySuggestion}
            hasDesignRefs={visibleRefImages.length > 0}
            enableCompose={true}
            onApplyComposedPrompt={handleApplyComposedPrompt}
            changeRequestText={changeDescription}
            isComposing={isComposing}
            onComposePrompt={handleComposePrompt}
            referenceImages={referenceImagesWithPreviews}
            onApplyStyleTransfer={handleApplyStyleTransfer}
          />

          {/* Change Request Textarea */}
          <div className="space-y-2">
            <Label htmlFor="change-request" className="text-sm font-medium">Change Request</Label>
            <Textarea
              id="change-request"
              placeholder="Describe the changes you want... e.g., 'Make the lighting warmer and remove the chair in the corner'"
              value={changeDescription}
              onChange={(e) => {
                setChangeDescription(e.target.value);
                setComposedPrompt(null); // Clear composed when editing
              }}
              rows={4}
              className="resize-none"
              disabled={!hasAttachments}
            />
            {composedPrompt && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <span>✓</span> Composed prompt ready to use
              </p>
            )}
          </div>

          {/* Output Options - Ratio & Quality */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border border-border/50">
            <div className="space-y-2">
              <Label htmlFor="edit-ratio">Output Ratio</Label>
              <Select value={selectedRatio} onValueChange={setSelectedRatio} disabled={!hasAttachments}>
                <SelectTrigger id="edit-ratio" className="bg-background">
                  <div className="flex items-center gap-2">
                    <AspectRatioPreview ratio={selectedRatio} size="sm" selected />
                    <span>{selectedRatio}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" /></SelectItem>
                  <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" /></SelectItem>
                  <SelectItem value="9:16"><AspectRatioSelectItemContent value="9:16" /></SelectItem>
                  <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" /></SelectItem>
                  <SelectItem value="3:4"><AspectRatioSelectItemContent value="3:4" /></SelectItem>
                  <SelectItem value="3:2"><AspectRatioSelectItemContent value="3:2" /></SelectItem>
                  <SelectItem value="2:3"><AspectRatioSelectItemContent value="2:3" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-quality">Output Quality</Label>
              <Select value={selectedQuality} onValueChange={setSelectedQuality} disabled={!hasAttachments}>
                <SelectTrigger id="edit-quality" className="bg-background">
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="1k" className="py-3">
                    <span className="font-medium">1K</span>
                    <span className="text-muted-foreground ml-2">· Fast</span>
                  </SelectItem>
                  <SelectItem value="2k" className="py-3">
                    <span className="font-medium">2K</span>
                    <span className="text-muted-foreground ml-2">· Balanced</span>
                  </SelectItem>
                  <SelectItem value="4k" className="py-3">
                    <span className="font-medium">4K</span>
                    <span className="text-muted-foreground ml-2">· Ultra</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reference Images */}
      <DropZone
        onFilesDropped={(files) => handleRefUpload(files)}
        accept="image/*"
        multiple
        disabled={uploading || visibleRefImages.length >= 4}
        isUploading={uploading}
        maxFiles={4}
        currentCount={visibleRefImages.length}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Reference Images (Optional) ({visibleRefImages.length}/4)
              </span>
              <DropZone.Button
                disabled={uploading || visibleRefImages.length >= 4}
                isUploading={uploading}
                size="sm"
                variant="outline"
              >
                Add Reference
              </DropZone.Button>
            </CardTitle>
            <CardDescription>
              Add reference images to guide the style of edits (drag & drop supported). Removing here only affects this session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {refLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : visibleRefImages.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">
                No references added. Drag & drop images here or click Add Reference.
              </p>
            ) : (
            <div className="flex gap-3 flex-wrap">
              {visibleRefImages.map((ref) => {
                if (!imagePreviews[ref.id]) {
                  loadPreview(ref.id, ref.bucket, ref.path);
                }
                
                return (
                  <div key={ref.id} className="relative group w-24 h-24 rounded-lg overflow-hidden border">
                    <LazyImage
                      src={imagePreviews[ref.id]}
                      alt={ref.original_filename || "Reference"}
                      className="w-full h-full"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-0.5 right-0.5 h-6 w-6 bg-background/80 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition-opacity"
                      onClick={() => handleDetachRef(ref.id)}
                      title="Remove from this session (not deleted globally)"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
                      {ref.original_filename}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </DropZone>

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleSubmitEdit}
          disabled={isSubmitting || !hasAttachments || (!changeDescription.trim() && !composedPrompt)}
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4 mr-2" />
          )}
          {isBatchMode 
            ? `Start Batch Edit (${attachments.length} images)` 
            : composedPrompt 
            ? "Start Edit (Composed)" 
            : "Start Edit"}
        </Button>
      </div>
    </div>
  );
});
