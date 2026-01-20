import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "./useStorage";
import { Tables, TablesInsert } from "@/integrations/supabase/types";
import { resizeImageForUpload, createResizedFile } from "@/lib/imageResize";

type Upload = Tables<"uploads">;
type UploadInsert = TablesInsert<"uploads">;

export function useUploads(projectId: string, kind?: "panorama" | "design_ref" | "output" | "floor_plan") {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { uploadFile } = useStorage();

  const uploadsQuery = useQuery({
    queryKey: ["uploads", projectId, kind],
    queryFn: async () => {
      let query = supabase
        .from("uploads")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      
      if (kind) {
        query = query.eq("kind", kind);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Upload[];
    },
    enabled: !!user && !!projectId
  });

  const createUpload = useMutation({
    mutationFn: async ({ 
      file, 
      kind: uploadKind 
    }: { 
      file: File; 
      kind: "panorama" | "design_ref" | "floor_plan" 
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Resize image on client-side before upload (max 1024px, JPEG 0.8 quality)
      console.log(`Preparing upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      let fileToUpload = file;
      try {
        const resizeResult = await resizeImageForUpload(file);
        if (resizeResult.wasResized) {
          fileToUpload = createResizedFile(resizeResult.blob, file.name);
          console.log(`Resized: ${resizeResult.originalWidth}x${resizeResult.originalHeight} → ${resizeResult.width}x${resizeResult.height}`);
        }
      } catch (resizeError) {
        console.warn("Image resize failed, uploading original:", resizeError);
        // Continue with original file if resize fails
      }

      const bucket = uploadKind === "panorama" ? "panoramas" : uploadKind === "design_ref" ? "design_refs" : "floor_plans";
      // Path must start with user_id to match RLS policies
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${fileToUpload.name}`;
      
      try {
        await uploadFile(bucket, path, fileToUpload);
      } catch (uploadError) {
        console.error("Upload error:", uploadError);
        throw new Error(`Failed to upload file: ${uploadError instanceof Error ? uploadError.message : "Unknown error"}`);
      }

      const { data, error } = await supabase
        .from("uploads")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          kind: uploadKind,
          bucket,
          path,
          original_filename: file.name, // Keep original name for display
          mime_type: fileToUpload.type,
          size_bytes: fileToUpload.size
        } as UploadInsert)
        .select()
        .single();

      if (error) throw error;
      return data as Upload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
    }
  });

  const deleteUpload = useMutation({
    mutationFn: async (upload: Upload) => {
      // Delete from storage first
      const { error: storageError } = await supabase.storage
        .from(upload.bucket)
        .remove([upload.path]);
      
      if (storageError) {
        console.error("Storage delete error:", storageError);
      }

      // Delete from database
      const { error } = await supabase.from("uploads").delete().eq("id", upload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
    }
  });

  return {
    uploads: uploadsQuery.data ?? [],
    isLoading: uploadsQuery.isLoading,
    error: uploadsQuery.error,
    createUpload,
    deleteUpload
  };
}
