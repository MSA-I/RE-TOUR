import { memo, useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStorage } from "@/hooks/useStorage";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  X,
  Loader2,
  Sparkles,
  Lock,
  Image as ImageIcon,
  AlertCircle,
  ChevronDown,
  FolderOpen,
  Check
} from "lucide-react";

export interface DesignReferenceItem {
  uploadId: string;
  url: string;
  filename: string;
  source?: "upload" | "library";
}

interface PipelineDesignReferenceUploaderProps {
  pipelineId: string;
  projectId: string;
  /** Current design reference upload IDs stored in pipeline */
  existingRefIds: string[];
  /** Callback to persist the reference IDs to the pipeline */
  onReferencesChange: (refIds: string[]) => void;
  /** Is locked (pipeline has progressed past Step 2) */
  isLocked?: boolean;
  /** Has the pipeline started (space analysis or step 1 has begun) */
  hasStarted?: boolean;
  /** Current step number (0-6) */
  currentStep?: number;
  /** Current phase for determining if Step 2 is running */
  currentPhase?: string;
}

export const PipelineDesignReferenceUploader = memo(function PipelineDesignReferenceUploader({
  pipelineId,
  projectId,
  existingRefIds,
  onReferencesChange,
  isLocked = false,
  hasStarted = false,
  currentStep = 0,
  currentPhase = "",
}: PipelineDesignReferenceUploaderProps) {
  const { user } = useAuth();
  const { uploadFile, getSignedViewUrl } = useStorage();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [references, setReferences] = useState<DesignReferenceItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!hasStarted); // Collapsed by default after start

  // Library picker state
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryRefs, setLibraryRefs] = useState<DesignReferenceItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // Determine if Step 2 (Style) is currently active
  const isStep2Active = currentStep === 2 || currentPhase.includes("style");
  const isStep2Running = currentPhase === "style_running";
  const hasReferences = references.length > 0;

  // Load existing references on mount
  useEffect(() => {
    if (!existingRefIds || existingRefIds.length === 0) {
      setReferences([]);
      return;
    }

    const loadRefs = async () => {
      setIsLoading(true);
      try {
        const { data: uploads, error } = await supabase
          .from("uploads")
          .select("*")
          .is("deleted_at", null)
          .in("id", existingRefIds);

        if (error) throw error;

        const refsWithUrls: DesignReferenceItem[] = [];
        for (const upload of uploads || []) {
          const urlResult = await getSignedViewUrl(upload.bucket, upload.path);
          if (urlResult.signedUrl) {
            refsWithUrls.push({
              uploadId: upload.id,
              url: urlResult.signedUrl,
              filename: upload.original_filename || "Reference",
            });
          }
        }
        setReferences(refsWithUrls);
      } catch (error) {
        console.error("Failed to load design references:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadRefs();
  }, [existingRefIds, getSignedViewUrl]);

  // Load library references when picker opens
  const loadLibraryReferences = useCallback(async () => {
    if (!user || !projectId) return;

    setLoadingLibrary(true);
    try {
      // Get all design_ref uploads for this project
      const { data: uploads, error } = await supabase
        .from("uploads")
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", "design_ref")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get signed URLs for each
      const refsWithUrls: DesignReferenceItem[] = [];
      for (const upload of uploads || []) {
        const urlResult = await getSignedViewUrl(upload.bucket, upload.path);
        if (urlResult.signedUrl) {
          refsWithUrls.push({
            uploadId: upload.id,
            url: urlResult.signedUrl,
            filename: upload.original_filename || "Reference",
            source: "library"
          });
        }
      }

      setLibraryRefs(refsWithUrls);
    } catch (error) {
      console.error("Failed to load library references:", error);
    } finally {
      setLoadingLibrary(false);
    }
  }, [user, projectId, getSignedViewUrl]);

  useEffect(() => {
    if (libraryPickerOpen) {
      loadLibraryReferences();
    }
  }, [libraryPickerOpen, loadLibraryReferences]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !user) return;

    // Limit to 4 references
    const remaining = 4 - references.length;
    if (remaining <= 0) {
      toast({ title: "Maximum 4 design references allowed", variant: "destructive" });
      return;
    }

    const filesToUpload = files.slice(0, remaining);
    setIsUploading(true);

    try {
      const newRefs: DesignReferenceItem[] = [];

      for (const file of filesToUpload) {
        // Sanitize filename: remove non-ASCII characters and special chars
        const sanitizedName = file.name
          .normalize("NFD") // Decompose accented characters
          .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
          .replace(/[^\x00-\x7F]/g, "") // Remove non-ASCII characters
          .replace(/[^a-zA-Z0-9._-]/g, "_") // Replace unsafe chars with underscore
          .replace(/_+/g, "_") // Collapse multiple underscores
          .replace(/^_|_$/g, ""); // Trim leading/trailing underscores

        const path = `${user.id}/${projectId}/wa_design_ref_${pipelineId}_${Date.now()}_${sanitizedName}`;

        // Upload file
        await uploadFile("design_refs", path, file);

        // Create upload record
        const { data: uploadRecord, error } = await supabase
          .from("uploads")
          .insert({
            project_id: projectId,
            owner_id: user.id,
            bucket: "design_refs",
            path,
            kind: "design_ref",
            mime_type: file.type,
            original_filename: file.name,
            size_bytes: file.size,
          })
          .select()
          .single();

        if (error) throw error;

        // Get signed URL for preview
        const urlResult = await getSignedViewUrl("design_refs", path);

        if (uploadRecord && urlResult.signedUrl) {
          newRefs.push({
            uploadId: uploadRecord.id,
            url: urlResult.signedUrl,
            filename: file.name,
            source: "upload"
          });
        }
      }

      const updatedRefs = [...references, ...newRefs];
      setReferences(updatedRefs);
      onReferencesChange(updatedRefs.map((r) => r.uploadId));

      toast({ title: `${newRefs.length} design reference(s) uploaded` });
    } catch (error) {
      console.error("Upload failed:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [user, projectId, pipelineId, references, uploadFile, getSignedViewUrl, onReferencesChange, toast]);

  const handleRemove = useCallback((uploadId: string) => {
    const updatedRefs = references.filter((r) => r.uploadId !== uploadId);
    setReferences(updatedRefs);
    onReferencesChange(updatedRefs.map((r) => r.uploadId));
  }, [references, onReferencesChange]);

  // Add a library reference to the current selection
  const handleAddLibraryRef = useCallback((ref: DesignReferenceItem) => {
    // Check if already selected
    if (references.some(r => r.uploadId === ref.uploadId)) {
      toast({ title: "Reference already selected" });
      return;
    }

    // Check limit
    if (references.length >= 4) {
      toast({ title: "Maximum 4 design references allowed", variant: "destructive" });
      return;
    }

    const updatedRefs = [...references, { ...ref, source: "library" as const }];
    setReferences(updatedRefs);
    onReferencesChange(updatedRefs.map((r) => r.uploadId));
    setLibraryPickerOpen(false);
    toast({ title: "Reference added from library" });
  }, [references, onReferencesChange, toast]);

  // After pipeline starts, show collapsed summary by default
  const showCollapsedSummary = hasStarted && !isExpanded;

  return (
    <Card className={`border-border/50 overflow-hidden ${isLocked ? "opacity-60" : ""}`}>
      <CardContent className="p-3 space-y-3">
        {/* Step 2 Active Indicator - Show when Step 2 is running with references */}
        {isStep2Active && hasReferences && (
          <div className={cn(
            "flex items-center gap-2 text-xs px-2 py-1.5 rounded-md border",
            isStep2Running
              ? "bg-primary/10 border-primary/30 text-primary animate-pulse"
              : "bg-muted/50 border-border text-muted-foreground"
          )}>
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-medium">
              {isStep2Running
                ? `Using ${references.length} design reference${references.length > 1 ? "s" : ""} for style transfer...`
                : `Design reference${references.length > 1 ? "s" : ""} will be applied in this step`
              }
            </span>
          </div>
        )}

        {/* Header - clickable to expand/collapse after start */}
        <div
          className={`flex items-center justify-between ${hasStarted ? "cursor-pointer hover:bg-muted/20 -m-3 p-3 rounded-lg transition-colors" : ""}`}
          onClick={hasStarted ? () => setIsExpanded(!isExpanded) : undefined}
        >
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Lock className="h-4 w-4 text-muted-foreground" />
            ) : isStep2Active && hasReferences ? (
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
            <span className="text-sm font-medium">
              Design Reference Images
              {!hasStarted && <span className="text-muted-foreground font-normal ml-1">(Optional)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isStep2Active && hasReferences && (
              <Badge variant="default" className="text-[10px] bg-primary/20 text-primary border-primary/30">
                Active
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {references.length}/4
            </Badge>
            {hasStarted && (
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            )}
          </div>
        </div>

        {/* Collapsed summary after start */}
        {showCollapsedSummary && hasReferences && (
          <div className="flex items-center gap-2 flex-wrap">
            {references.slice(0, 4).map((ref) => (
              <div
                key={ref.uploadId}
                className="w-10 h-10 rounded border border-border overflow-hidden flex-shrink-0 relative"
              >
                <img
                  src={ref.url}
                  alt={ref.filename}
                  className="w-full h-full object-cover"
                />
                {ref.source === "library" && (
                  <div className="absolute top-0 left-0 p-0.5 rounded-br bg-primary/80">
                    <FolderOpen className="h-2 w-2 text-white" />
                  </div>
                )}
              </div>
            ))}
            <span className="text-xs text-muted-foreground">
              {references.length} reference{references.length !== 1 ? "s" : ""} attached
              {isStep2Active ? " (applying now)" : " (Step 2 only)"}
            </span>
          </div>
        )}

        {showCollapsedSummary && !hasReferences && (
          <p className="text-xs text-muted-foreground">No design references uploaded</p>
        )}

        {/* Full UI when expanded or before start */}
        {(!hasStarted || isExpanded) && (
          <>
            {/* Info note */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Reference images affect <strong>ONLY the realistic 2D styling step (Step 2)</strong>.
                They do not influence geometry, camera angles, or panoramas.
              </span>
            </div>

            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Reference thumbnails */}
            {!isLoading && hasReferences && (
              <div className="grid grid-cols-4 gap-2">
                {references.map((ref) => (
                  <div
                    key={ref.uploadId}
                    className="relative group aspect-square rounded-md overflow-hidden border border-border"
                  >
                    <img
                      src={ref.url}
                      alt={ref.filename}
                      className="w-full h-full object-cover"
                    />
                    {ref.source === "library" && (
                      <div className="absolute top-1 left-1 p-0.5 rounded bg-primary/80">
                        <FolderOpen className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                    {!isLocked && (
                      <button
                        onClick={() => handleRemove(ref.uploadId)}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-destructive/80 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                      <p className="text-[10px] text-white truncate">{ref.filename}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upload & Library buttons */}
            {!isLocked && (
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={isUploading || references.length >= 4}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLibraryPickerOpen(true)}
                  disabled={isUploading || references.length >= 4}
                  className="h-7 text-xs"
                >
                  <FolderOpen className="h-3 w-3 mr-1" />
                  From Library
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || references.length >= 4}
                  className="flex-1"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {hasReferences ? "Add More" : "Upload New"}
                </Button>
              </div>
            )}

            {/* Locked state message */}
            {isLocked && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                References locked after Step 2 completes
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Library Picker Dialog */}
      <Dialog open={libraryPickerOpen} onOpenChange={setLibraryPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              Select from Library
            </DialogTitle>
            <DialogDescription>
              Choose from previously uploaded design references in this project.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-64">
            {loadingLibrary ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : libraryRefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                <ImageIcon className="h-8 w-8 mb-2" />
                <p>No existing references found</p>
                <p className="text-xs">Upload design references first</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 p-1">
                {libraryRefs.map((ref) => {
                  const isAlreadySelected = references.some(r => r.uploadId === ref.uploadId);
                  return (
                    <button
                      key={ref.uploadId}
                      onClick={() => handleAddLibraryRef(ref)}
                      disabled={isAlreadySelected}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${isAlreadySelected
                          ? "border-muted opacity-50 cursor-not-allowed"
                          : "border-border hover:border-primary"
                        }`}
                    >
                      <img
                        src={ref.url}
                        alt={ref.filename}
                        className="w-full h-full object-cover"
                      />
                      {isAlreadySelected && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Check className="h-5 w-5 text-white" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                        <p className="text-[10px] text-white truncate">{ref.filename}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLibraryPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
});
