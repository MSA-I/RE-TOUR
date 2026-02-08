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
    const { data, error } = await supabase.functions.invoke("delete-upload", {
      body: { upload_id: uploadId, force_db_only: forceDbOnly },
    });
    if (error) throw error;
    return data;
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
