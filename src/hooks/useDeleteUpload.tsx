import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useRef, useCallback } from "react";

// Pending deletion tracking
interface PendingDeletion {
  uploadId: string;
  timeoutId: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

export function useDeleteUpload(projectId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Track pending deletions for undo functionality
  const pendingDeletions = useRef<Map<string, PendingDeletion>>(new Map());
  
  // Undo timeout in milliseconds (6 seconds)
  const UNDO_TIMEOUT = 6000;
  
  // Actually perform the deletion
  const performDeletion = async (uploadId: string, forceDbOnly: boolean) => {
    console.log(`[useDeleteUpload] Attempting to delete ${uploadId} (forceDbOnly: ${forceDbOnly})`);
    
    try {
      const { data, error } = await supabase.functions.invoke("delete-upload", {
        body: { upload_id: uploadId, force_db_only: forceDbOnly },
      });

      if (error) {
        console.warn("[useDeleteUpload] Edge Function failed, attempting client-side fallback:", error);
        throw error; // Trigger fallback in catch block
      }
      
      console.log("[useDeleteUpload] Edge Function success:", data);
      return data;
    } catch (functionError) {
      console.log("[useDeleteUpload] Falling back to client-side deletion logic...");
      
      // 1. Fetch upload to get details
      const { data: upload, error: fetchError } = await supabase
        .from("uploads")
        .select("*")
        .eq("id", uploadId)
        .single();
        
      if (fetchError || !upload) {
        throw new Error(`Could not fetch upload details for deletion: ${fetchError?.message}`);
      }
      
      // 2. Handle dependencies (basic cleanup for outputs)
      if (upload.kind === "output") {
        // Nullify references in render_jobs
        await supabase
          .from("render_jobs")
          .update({ output_upload_id: null })
          .eq("output_upload_id", uploadId);
          
        // Note: For 'panorama' or 'design_ref', we might hit FK constraints if we don't clean up.
        // But preventing complex logic duplication, we'll try to delete and let DB enforce constraints if any.
      }
      
      // 3. Delete from Storage (if not force_db_only)
      if (!forceDbOnly && upload.bucket && upload.path) {
        const { error: storageError } = await supabase.storage
          .from(upload.bucket)
          .remove([upload.path]);
          
        if (storageError) {
          console.warn("[useDeleteUpload] Storage delete warning:", storageError);
          // Continue to DB delete even if storage fails (might be already gone)
        }
      }
      
      // 4. Delete from Database
      const { error: dbError } = await supabase
        .from("uploads")
        .delete()
        .eq("id", uploadId);
        
      if (dbError) {
        // Check for specific FK violation errors to give better feedback
        if (dbError.code === "23503") { // foreign_key_violation
          throw new Error("Cannot delete: This item is still being used by other jobs or pipelines.");
        }
        throw dbError;
      }
      
      return { success: true, method: "client-side" };
    }
  };
  
  // Cancel a pending deletion (undo)
  const undoDeletion = useCallback((uploadId: string) => {
    const pending = pendingDeletions.current.get(uploadId);
    if (pending) {
      pending.cancelled = true;
      clearTimeout(pending.timeoutId);
      pendingDeletions.current.delete(uploadId);
      
      // Restore in UI by invalidating queries
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
      queryClient.invalidateQueries({ queryKey: ["creations", projectId] });
      
      toast({ title: "Deletion undone", description: "Item restored successfully" });
    }
  }, [projectId, queryClient, toast]);

  const deleteUpload = useMutation({
    mutationFn: async ({ uploadId, forceDbOnly = false }: { uploadId: string; forceDbOnly?: boolean }) => {
      // Check if already pending
      if (pendingDeletions.current.has(uploadId)) {
        throw new Error("Deletion already pending");
      }
      
      // Return immediately for optimistic UI update
      return { uploadId, forceDbOnly, pending: true };
    },
    onSuccess: ({ uploadId, forceDbOnly }) => {
      // Optimistically remove from UI
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
      queryClient.invalidateQueries({ queryKey: ["creations", projectId] });
      
      // Create pending deletion with undo timeout
      const timeoutId = setTimeout(async () => {
        const pending = pendingDeletions.current.get(uploadId);
        if (pending && !pending.cancelled) {
          try {
            // Actually perform the deletion
            await performDeletion(uploadId, forceDbOnly);
            pendingDeletions.current.delete(uploadId);
            // Final invalidation after actual deletion
            queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
            queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
          } catch (error) {
            console.error("Failed to delete upload:", error);
            toast({
              title: "Deletion failed",
              description: error instanceof Error ? error.message : "Unknown error",
              variant: "destructive"
            });
            // Restore in UI
            queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
          }
        }
      }, UNDO_TIMEOUT);
      
      pendingDeletions.current.set(uploadId, {
        uploadId,
        timeoutId,
        cancelled: false
      });
      
      // Show toast with undo action
      toast({
        title: "Deleted",
        description: "Item will be permanently removed",
        action: (
          <ToastAction 
            altText="Undo" 
            onClick={() => undoDeletion(uploadId)}
          >
            Undo
          </ToastAction>
        ),
        duration: UNDO_TIMEOUT - 500, // Slightly less than timeout to ensure undo works
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete upload",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Return the mutation directly (so .mutateAsync is accessible) with additional helpers
  return Object.assign(deleteUpload, {
    undoDeletion,
    isPendingDeletion: (uploadId: string) => pendingDeletions.current.has(uploadId)
  });
}
