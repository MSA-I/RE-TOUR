import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// TYPES
// ============================================================================

interface UrlResult {
  upload_id: string;
  signed_url: string | null;
  expires_at: string | null;
  error?: string;
}

interface ImageMetadata {
  upload_id: string;
  original_width: number | null;
  original_height: number | null;
  file_size: number | null;
  file_hash: string | null;
  mime_type: string | null;
  original_filename: string | null;
  has_preview: boolean;
  preview_upload_id: string | null;
  processing_status: string;
}

interface CreatePreviewResult {
  upload_id: string;
  original_width?: number;
  original_height?: number;
  file_hash?: string;
  status: string;
  message?: string;
  preview_upload_id?: string;
}

interface BatchUrlsResult {
  urls: UrlResult[];
}

// ============================================================================
// HOOK
// ============================================================================

export function useImageIO() {
  /**
   * Get a signed preview URL for an upload
   * If a preview exists, returns that; otherwise returns original
   */
  const getPreviewUrl = useCallback(async (
    uploadId: string,
    options?: { maxWidth?: number; expiresIn?: number }
  ): Promise<UrlResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("image-io-service", {
        body: {
          action: "get_preview_url",
          upload_id: uploadId,
          max_width: options?.maxWidth ?? 1024,
          expires_in: options?.expiresIn ?? 3600,
        },
      });

      if (error) throw error;
      return data as UrlResult;
    } catch (err) {
      console.error("[useImageIO] getPreviewUrl error:", err);
      return {
        upload_id: uploadId,
        signed_url: null,
        expires_at: null,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }, []);

  /**
   * Get a signed URL for the original (full quality) upload
   */
  const getOriginalUrl = useCallback(async (
    uploadId: string,
    options?: { expiresIn?: number }
  ): Promise<UrlResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("image-io-service", {
        body: {
          action: "get_original_url",
          upload_id: uploadId,
          expires_in: options?.expiresIn ?? 3600,
        },
      });

      if (error) throw error;
      return data as UrlResult;
    } catch (err) {
      console.error("[useImageIO] getOriginalUrl error:", err);
      return {
        upload_id: uploadId,
        signed_url: null,
        expires_at: null,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }, []);

  /**
   * Get metadata for an upload (dimensions, hash, etc.)
   */
  const getMetadata = useCallback(async (uploadId: string): Promise<ImageMetadata | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("image-io-service", {
        body: {
          action: "get_metadata",
          upload_id: uploadId,
        },
      });

      if (error) throw error;
      return data as ImageMetadata;
    } catch (err) {
      console.error("[useImageIO] getMetadata error:", err);
      return null;
    }
  }, []);

  /**
   * Create a preview for an upload (extracts metadata, prepares for preview generation)
   */
  const createPreview = useCallback(async (
    uploadId: string,
    options?: { maxWidth?: number; maxHeight?: number; quality?: number }
  ): Promise<CreatePreviewResult | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("image-io-service", {
        body: {
          action: "create_preview",
          upload_id: uploadId,
          max_width: options?.maxWidth ?? 1024,
          max_height: options?.maxHeight ?? 1024,
          quality: options?.quality ?? 80,
        },
      });

      if (error) throw error;
      return data as CreatePreviewResult;
    } catch (err) {
      console.error("[useImageIO] createPreview error:", err);
      return null;
    }
  }, []);

  /**
   * Get signed URLs for multiple uploads in one call (batch operation)
   */
  const getBatchUrls = useCallback(async (
    uploadIds: string[],
    urlType: "preview" | "original" = "preview",
    options?: { expiresIn?: number }
  ): Promise<BatchUrlsResult> => {
    try {
      if (uploadIds.length === 0) {
        return { urls: [] };
      }

      const { data, error } = await supabase.functions.invoke("image-io-service", {
        body: {
          action: "get_batch_urls",
          upload_ids: uploadIds,
          url_type: urlType,
          expires_in: options?.expiresIn ?? 3600,
        },
      });

      if (error) throw error;
      return data as BatchUrlsResult;
    } catch (err) {
      console.error("[useImageIO] getBatchUrls error:", err);
      return {
        urls: uploadIds.map(id => ({
          upload_id: id,
          signed_url: null,
          expires_at: null,
          error: err instanceof Error ? err.message : "Unknown error",
        })),
      };
    }
  }, []);

  return useMemo(() => ({
    getPreviewUrl,
    getOriginalUrl,
    getMetadata,
    createPreview,
    getBatchUrls,
  }), [getPreviewUrl, getOriginalUrl, getMetadata, createPreview, getBatchUrls]);
}
