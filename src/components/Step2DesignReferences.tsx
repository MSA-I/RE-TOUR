import { useState, useCallback, memo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropZone } from "@/components/ui/drop-zone";
import { useStorage } from "@/hooks/useStorage";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Loader2, Check, Image as ImageIcon, Sparkles, Lock, FolderOpen } from "lucide-react";

interface DesignReference {
  uploadId: string;
  url: string;
  filename: string;
  source?: "upload" | "panorama"; // Track where the reference came from
}

interface Step2DesignReferencesProps {
  pipelineId: string;
  projectId: string;
  references: DesignReference[];
  onReferencesChange: (refs: DesignReference[]) => void;
  isUploading: boolean;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  isLocked?: boolean; // Mutual exclusion: locked when AI suggestions are in use
  lockedReason?: string;
}

function Step2DesignReferencesComponent({
  pipelineId,
  projectId,
  references,
  onReferencesChange,
  isUploading,
  onUploadStart,
  onUploadEnd,
  isLocked = false,
  lockedReason
}: Step2DesignReferencesProps) {
  const { user } = useAuth();
  const { uploadFile, getSignedViewUrl } = useStorage();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Panorama references state
  const [panoramaRefs, setPanoramaRefs] = useState<DesignReference[]>([]);
  const [loadingPanoramaRefs, setLoadingPanoramaRefs] = useState(false);
  const [panoramaPickerOpen, setPanoramaPickerOpen] = useState(false);

  // Load available panorama references
  const loadPanoramaReferences = useCallback(async () => {
    if (!user || !projectId) return;
    
    setLoadingPanoramaRefs(true);
    try {
      // Get design_ref uploads for this project (could be from panorama workflow)
      const { data: uploads, error } = await supabase
        .from("uploads")
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", "design_ref")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get signed URLs for each
      const refsWithUrls: DesignReference[] = [];
      for (const upload of uploads || []) {
        const urlResult = await getSignedViewUrl(upload.bucket, upload.path);
        if (urlResult.signedUrl) {
          refsWithUrls.push({
            uploadId: upload.id,
            url: urlResult.signedUrl,
            filename: upload.original_filename || "Reference",
            source: "panorama"
          });
        }
      }

      setPanoramaRefs(refsWithUrls);
    } catch (error) {
      console.error("Failed to load panorama references:", error);
    } finally {
      setLoadingPanoramaRefs(false);
    }
  }, [user, projectId, getSignedViewUrl]);

  // Load panorama refs when picker opens
  useEffect(() => {
    if (panoramaPickerOpen) {
      loadPanoramaReferences();
    }
  }, [panoramaPickerOpen, loadPanoramaReferences]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!user) return;

    // Limit to 5 references
    const remaining = 5 - references.length;
    if (remaining <= 0) {
      toast({ title: "Maximum 5 design references allowed", variant: "destructive" });
      return;
    }

    const filesToUpload = files.slice(0, remaining);
    onUploadStart();

    try {
      for (const file of filesToUpload) {
        const path = `${user.id}/${projectId}/design_ref_${pipelineId}_${Date.now()}_${file.name}`;
        
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
            size_bytes: file.size
          })
          .select()
          .single();

        if (error) throw error;

        // Get signed URL for preview
        const urlResult = await getSignedViewUrl("design_refs", path);
        
        if (uploadRecord && urlResult.signedUrl) {
          onReferencesChange([
            ...references,
            {
              uploadId: uploadRecord.id,
              url: urlResult.signedUrl,
              filename: file.name,
              source: "upload"
            }
          ]);
        }
      }

      toast({ title: `${filesToUpload.length} design reference(s) uploaded` });
    } catch (error) {
      console.error("Upload failed:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      onUploadEnd();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [user, projectId, pipelineId, references, uploadFile, getSignedViewUrl, onReferencesChange, onUploadStart, onUploadEnd, toast]);

  const handleRemove = useCallback((uploadId: string) => {
    // Only detach locally - do not delete the actual file
    onReferencesChange(references.filter(r => r.uploadId !== uploadId));
  }, [references, onReferencesChange]);

  // Add a panorama reference to the current selection
  const handleAddPanoramaRef = useCallback((ref: DesignReference) => {
    // Check if already selected
    if (references.some(r => r.uploadId === ref.uploadId)) {
      toast({ title: "Reference already selected" });
      return;
    }

    // Check limit
    if (references.length >= 5) {
      toast({ title: "Maximum 5 design references allowed", variant: "destructive" });
      return;
    }

    onReferencesChange([...references, { ...ref, source: "panorama" }]);
    setPanoramaPickerOpen(false);
    toast({ title: "Reference added from Panorama library" });
  }, [references, onReferencesChange, toast]);

  const hasReferences = references.length > 0;

  return (
    <TooltipProvider>
      <div className={`space-y-3 p-3 rounded-lg border transition-all ${
        isLocked 
          ? "border-muted bg-muted/30 opacity-60" 
          : hasReferences
          ? "border-primary bg-primary/5"
          : "border-primary/30 bg-primary/5"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Tooltip>
                <TooltipTrigger>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{lockedReason || "Locked"}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
            <Label className="text-sm font-medium">Design References (Step 2 Only)</Label>
            {references.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {references.length}/5
              </Badge>
            )}
            {isLocked && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Locked
              </Badge>
            )}
          </div>
          
          {!isLocked && (
            <div className="flex items-center gap-1">
              {/* Button to pick from existing panorama references */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanoramaPickerOpen(true)}
                disabled={isUploading || references.length >= 5}
                className="h-7 text-xs"
              >
                <FolderOpen className="h-3 w-3 mr-1" />
                From Library
              </Button>
              
              {/* Upload new button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || references.length >= 5}
                className="h-7 text-xs"
              >
                {isUploading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3 mr-1" />
                )}
                Upload
              </Button>
            </div>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={isLocked}
          />
        </div>

        {isLocked ? (
          <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
            <Lock className="h-3 w-3" />
            {lockedReason || "Clear AI suggestions to use design references"}
          </div>
        ) : references.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            Upload or select design references for style transfer. These will define the design aesthetic of Step 2 output.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {references.map((ref) => (
              <div
                key={ref.uploadId}
                className="relative w-16 h-16 rounded-md overflow-hidden border border-border group"
              >
                <img
                  src={ref.url}
                  alt={ref.filename}
                  className="w-full h-full object-cover"
                />
                {ref.source === "panorama" && (
                  <div className="absolute top-0.5 left-0.5 p-0.5 rounded bg-primary/80">
                    <FolderOpen className="h-2.5 w-2.5 text-white" />
                  </div>
                )}
                <button
                  onClick={() => handleRemove(ref.uploadId)}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Panorama Reference Picker Dialog */}
        <Dialog open={panoramaPickerOpen} onOpenChange={setPanoramaPickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-primary" />
                Select from Panorama References
              </DialogTitle>
              <DialogDescription>
                Choose from previously uploaded design references in this project.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-64">
              {loadingPanoramaRefs ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : panoramaRefs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                  <ImageIcon className="h-8 w-8 mb-2" />
                  <p>No existing references found</p>
                  <p className="text-xs">Upload design references in the Panorama tab first</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 p-1">
                  {panoramaRefs.map((ref) => {
                    const isAlreadySelected = references.some(r => r.uploadId === ref.uploadId);
                    return (
                      <button
                        key={ref.uploadId}
                        onClick={() => handleAddPanoramaRef(ref)}
                        disabled={isAlreadySelected}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                          isAlreadySelected 
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
              <Button variant="ghost" onClick={() => setPanoramaPickerOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

export const Step2DesignReferences = memo(Step2DesignReferencesComponent);

// Reference Selection Modal for when user clicks "Run Step 2"
interface Step2ReferenceSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  references: DesignReference[];
  onContinue: (selectedIds: string[]) => void;
  onRunWithoutRefs: () => void;
}

export function Step2ReferenceSelectionModal({
  isOpen,
  onClose,
  references,
  onContinue,
  onRunWithoutRefs
}: Step2ReferenceSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = (uploadId: string) => {
    setSelectedIds(prev => 
      prev.includes(uploadId) 
        ? prev.filter(id => id !== uploadId)
        : [...prev, uploadId]
    );
  };

  const handleContinue = () => {
    if (selectedIds.length > 0) {
      onContinue(selectedIds);
    }
  };

  // Reset selection when modal opens
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Select Design Style References
          </DialogTitle>
          <DialogDescription>
            Which reference images should influence the design style of the output?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ScrollArea className="h-48">
            <div className="grid grid-cols-3 gap-3">
              {references.map((ref) => {
                const isSelected = selectedIds.includes(ref.uploadId);
                return (
                  <button
                    key={ref.uploadId}
                    onClick={() => toggleSelection(ref.uploadId)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      isSelected 
                        ? "border-primary ring-2 ring-primary/30" 
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <img
                      src={ref.url}
                      alt={ref.filename}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute top-1 right-1 p-1 rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                    {ref.source === "panorama" && (
                      <div className="absolute top-1 left-1 p-0.5 rounded bg-primary/80">
                        <FolderOpen className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                      <p className="text-[10px] text-white truncate">{ref.filename}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge className="bg-primary/20 text-primary">
                {selectedIds.length} selected
              </Badge>
              <span>Style transfer will be applied</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onRunWithoutRefs}>
            Run Without References
          </Button>
          <Button 
            onClick={handleContinue}
            disabled={selectedIds.length === 0}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Continue with {selectedIds.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
