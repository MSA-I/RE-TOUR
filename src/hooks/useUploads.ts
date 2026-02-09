import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "./useStorage";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

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
        .is("deleted_at", null)
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
    // ... (rest of the createUpload mutation remains same)
    mutationFn: async ({
      file,
      kind: uploadKind
    }: {
      file: File;
      kind: "panorama" | "design_ref" | "floor_plan"
    }) => {
      if (!user) throw new Error("Not authenticated");

      console.log(`Preparing upload (ORIGINAL quality): ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

      const bucket = uploadKind === "panorama" ? "panoramas" : uploadKind === "design_ref" ? "design_refs" : "floor_plans";
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w\.-]/g, "_")}`;

      try {
        await uploadFile(bucket, path, file);
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
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size
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

  const softDeleteUpload = useMutation({
    mutationFn: async (uploadIds: string[]) => {
      const { error } = await supabase
        .from("uploads")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id
        })
        .in("id", uploadIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
    }
  });

  const deleteUpload = useMutation({
    mutationFn: async (upload: Upload) => {
      // Keep hard-delete for specific scenarios if needed, but UI should use softDelete
      const { error: storageError } = await supabase.storage
        .from(upload.bucket)
        .remove([upload.path]);

      if (storageError) {
        console.error("Storage delete error:", storageError);
      }

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
    softDeleteUpload,
    deleteUpload
  };
}
