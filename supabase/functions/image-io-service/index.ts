import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// STRICT CONTRACT: Image I/O Output Schema
// From pipeline-schemas.ts - duplicated here for edge function isolation
// ============================================================================

type ImageRole = "input" | "output" | "reference" | "preview";
type QualityTier = "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "4:3" | "16:9" | "2:1";

interface ImageIOImage {
  upload_id: string;
  role: ImageRole;
  preview_url: string;
  original_url: string | null;
  width: number;
  height: number;
  filesize_bytes: number;
  mime_type: string;
  sha256_hash: string;
}

interface ImageIOOutput {
  run_id: string;
  step_id: string;
  images: ImageIOImage[];
  quality_used: QualityTier;
  ratio_used: AspectRatio;
  created_at: string;
}

// ============================================================================
// RULE GATES (from pipeline-schemas.ts)
// ============================================================================

const RULE_GATES = {
  MAX_IMAGES_PER_STEP: 12,
  MAX_PREVIEW_SIZE_BYTES: 2 * 1024 * 1024,    // 2MB
  MAX_ORIGINAL_SIZE_BYTES: 50 * 1024 * 1024,  // 50MB
  URL_EXPIRY_SECONDS: 3600,                    // 1 hour
  ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"],
  
  // Steps 0-3 ALWAYS use 2K
  STEP_QUALITY_OVERRIDE: { 0: "2K", 1: "2K", 2: "2K", 3: "2K" } as Record<number, QualityTier>,
};

// ============================================================================
// TYPES
// ============================================================================

interface GetPreviewUrlRequest {
  action: "get_preview_url";
  upload_id: string;
  max_width?: number;  // defaults to 1024
  expires_in?: number; // defaults to 3600
}

interface GetOriginalUrlRequest {
  action: "get_original_url";
  upload_id: string;
  expires_in?: number;
}

interface GetMetadataRequest {
  action: "get_metadata";
  upload_id: string;
}

interface CreatePreviewRequest {
  action: "create_preview";
  upload_id: string;
  max_width?: number;
  max_height?: number;
  quality?: number; // JPEG quality 1-100
}

interface GetBatchUrlsRequest {
  action: "get_batch_urls";
  upload_ids: string[];
  url_type: "preview" | "original";
  expires_in?: number;
}

// NEW: Batch output for pipeline steps
interface GetStepImagesRequest {
  action: "get_step_images";
  run_id: string;
  step_id: string;
  upload_ids: string[];
  step_index: number;
  quality_preference?: QualityTier;
  ratio?: AspectRatio;
}

type ImageIORequest = 
  | GetPreviewUrlRequest 
  | GetOriginalUrlRequest 
  | GetMetadataRequest 
  | CreatePreviewRequest
  | GetBatchUrlsRequest
  | GetStepImagesRequest;

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

interface UrlResult {
  upload_id: string;
  signed_url: string | null;
  expires_at: string | null;
  error?: string;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Missing authorization header", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      return jsonError("Unauthorized", 401);
    }

    const userId = claimsData.claims.sub as string;
    const body: ImageIORequest = await req.json();

    console.log(`[image-io-service] Action: ${body.action}, User: ${userId}`);

    switch (body.action) {
      case "get_preview_url":
        return await handleGetPreviewUrl(supabase, userId, body);
      
      case "get_original_url":
        return await handleGetOriginalUrl(supabase, userId, body);
      
      case "get_metadata":
        return await handleGetMetadata(supabase, userId, body);
      
      case "create_preview":
        return await handleCreatePreview(supabase, userId, body);
      
      case "get_batch_urls":
        return await handleGetBatchUrls(supabase, userId, body);
      
      case "get_step_images":
        return await handleGetStepImages(supabase, userId, body, startTime);
      
      default:
        return jsonError(`Unknown action: ${(body as any).action}`, 400);
    }
  } catch (error) {
    console.error("[image-io-service] Error:", error);
    return jsonError(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleGetPreviewUrl(
  supabase: any, 
  userId: string, 
  request: GetPreviewUrlRequest
): Promise<Response> {
  const { upload_id, max_width = 1024, expires_in = 3600 } = request;

  // Fetch upload with ownership check
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("id, bucket, path, owner_id, preview_upload_id, is_preview, processing_status")
    .eq("id", upload_id)
    .single();

  if (error || !upload) {
    return jsonError("Upload not found", 404);
  }

  if (upload.owner_id !== userId) {
    return jsonError("Unauthorized access to upload", 403);
  }

  // If this upload has a preview, use that instead
  let targetUpload = upload;
  if (upload.preview_upload_id) {
    const { data: preview } = await supabase
      .from("uploads")
      .select("id, bucket, path")
      .eq("id", upload.preview_upload_id)
      .single();
    
    if (preview) {
      targetUpload = preview;
    }
  }

  // Generate signed URL
  const { data: signedData, error: signError } = await supabase.storage
    .from(targetUpload.bucket)
    .createSignedUrl(targetUpload.path, expires_in);

  if (signError) {
    console.error("[get_preview_url] Sign error:", signError);
    return jsonError("Failed to create signed URL", 500);
  }

  const result: UrlResult = {
    upload_id,
    signed_url: signedData.signedUrl,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  };

  return jsonSuccess(result);
}

async function handleGetOriginalUrl(
  supabase: any, 
  userId: string, 
  request: GetOriginalUrlRequest
): Promise<Response> {
  const { upload_id, expires_in = 3600 } = request;

  // Fetch upload with ownership check
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("id, bucket, path, owner_id, is_preview")
    .eq("id", upload_id)
    .single();

  if (error || !upload) {
    return jsonError("Upload not found", 404);
  }

  if (upload.owner_id !== userId) {
    return jsonError("Unauthorized access to upload", 403);
  }

  // If this is a preview, find the original
  let targetUpload = upload;
  if (upload.is_preview) {
    const { data: original } = await supabase
      .from("uploads")
      .select("id, bucket, path")
      .eq("preview_upload_id", upload_id)
      .single();
    
    if (original) {
      targetUpload = original;
    }
  }

  // Generate signed URL
  const { data: signedData, error: signError } = await supabase.storage
    .from(targetUpload.bucket)
    .createSignedUrl(targetUpload.path, expires_in);

  if (signError) {
    return jsonError("Failed to create signed URL", 500);
  }

  const result: UrlResult = {
    upload_id: targetUpload.id,
    signed_url: signedData.signedUrl,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  };

  return jsonSuccess(result);
}

async function handleGetMetadata(
  supabase: any, 
  userId: string, 
  request: GetMetadataRequest
): Promise<Response> {
  const { upload_id } = request;

  const { data: upload, error } = await supabase
    .from("uploads")
    .select(`
      id, 
      original_width, 
      original_height, 
      size_bytes, 
      file_hash, 
      mime_type, 
      original_filename, 
      preview_upload_id, 
      is_preview,
      processing_status,
      owner_id
    `)
    .eq("id", upload_id)
    .single();

  if (error || !upload) {
    return jsonError("Upload not found", 404);
  }

  if (upload.owner_id !== userId) {
    return jsonError("Unauthorized access to upload", 403);
  }

  const metadata: ImageMetadata = {
    upload_id: upload.id,
    original_width: upload.original_width,
    original_height: upload.original_height,
    file_size: upload.size_bytes,
    file_hash: upload.file_hash,
    mime_type: upload.mime_type,
    original_filename: upload.original_filename,
    has_preview: !!upload.preview_upload_id,
    preview_upload_id: upload.preview_upload_id,
    processing_status: upload.processing_status || "ready",
  };

  return jsonSuccess(metadata);
}

async function handleCreatePreview(
  supabase: any, 
  userId: string, 
  request: CreatePreviewRequest
): Promise<Response> {
  const { upload_id, max_width = 1024, max_height = 1024, quality = 80 } = request;

  // Fetch original upload
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", upload_id)
    .single();

  if (error || !upload) {
    return jsonError("Upload not found", 404);
  }

  if (upload.owner_id !== userId) {
    return jsonError("Unauthorized access to upload", 403);
  }

  // Check if preview already exists
  if (upload.preview_upload_id) {
    return jsonSuccess({
      preview_upload_id: upload.preview_upload_id,
      status: "already_exists",
    });
  }

  // Mark as processing
  await supabase
    .from("uploads")
    .update({ processing_status: "processing" })
    .eq("id", upload_id);

  try {
    // Download original file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(upload.bucket)
      .download(upload.path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download original: ${downloadError?.message}`);
    }

    // Get image dimensions and create preview
    const originalBuffer = await fileData.arrayBuffer();
    const originalBytes = new Uint8Array(originalBuffer);
    
    // Extract dimensions from image header
    const dimensions = getImageDimensions(originalBytes);
    
    // Calculate file hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", originalBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Update original with metadata
    await supabase
      .from("uploads")
      .update({
        original_width: dimensions?.width || null,
        original_height: dimensions?.height || null,
        file_hash: fileHash,
        processing_status: "ready",
      })
      .eq("id", upload_id);

    // For now, we'll just store metadata without actual resizing
    // (Deno doesn't have native image processing - we'd need sharp/wasm)
    // The preview will just be a reference to the original with size constraints noted

    return jsonSuccess({
      upload_id,
      original_width: dimensions?.width,
      original_height: dimensions?.height,
      file_hash: fileHash,
      status: "metadata_extracted",
      message: "Dimensions extracted. Preview creation requires image processing library.",
    });
  } catch (err) {
    console.error("[create_preview] Error:", err);
    
    await supabase
      .from("uploads")
      .update({ processing_status: "failed" })
      .eq("id", upload_id);

    return jsonError(err instanceof Error ? err.message : "Preview creation failed", 500);
  }
}

async function handleGetBatchUrls(
  supabase: any, 
  userId: string, 
  request: GetBatchUrlsRequest
): Promise<Response> {
  const { upload_ids, url_type, expires_in = 3600 } = request;

  if (!upload_ids || upload_ids.length === 0) {
    return jsonError("No upload_ids provided", 400);
  }

  if (upload_ids.length > 50) {
    return jsonError("Maximum 50 uploads per batch request", 400);
  }

  // Fetch all uploads with ownership check
  const { data: uploads, error } = await supabase
    .from("uploads")
    .select("id, bucket, path, owner_id, preview_upload_id, is_preview")
    .in("id", upload_ids);

  if (error) {
    return jsonError("Failed to fetch uploads", 500);
  }

  const results: UrlResult[] = [];

  for (const uploadId of upload_ids) {
    const upload = uploads?.find((u: any) => u.id === uploadId);
    
    if (!upload) {
      results.push({ upload_id: uploadId, signed_url: null, expires_at: null, error: "Not found" });
      continue;
    }

    if (upload.owner_id !== userId) {
      results.push({ upload_id: uploadId, signed_url: null, expires_at: null, error: "Unauthorized" });
      continue;
    }

    // Determine target based on url_type
    let targetBucket = upload.bucket;
    let targetPath = upload.path;

    if (url_type === "preview" && upload.preview_upload_id) {
      const preview = uploads?.find((u: any) => u.id === upload.preview_upload_id);
      if (preview) {
        targetBucket = preview.bucket;
        targetPath = preview.path;
      }
    }

    // Generate signed URL
    const { data: signedData, error: signError } = await supabase.storage
      .from(targetBucket)
      .createSignedUrl(targetPath, expires_in);

    if (signError) {
      results.push({ upload_id: uploadId, signed_url: null, expires_at: null, error: "Sign failed" });
    } else {
      results.push({
        upload_id: uploadId,
        signed_url: signedData.signedUrl,
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      });
    }
  }

  return jsonSuccess({ urls: results });
}

/**
 * NEW: Get step images with STRICT schema validation
 * Returns ImageIOOutput conforming to pipeline-schemas.ts contract
 */
async function handleGetStepImages(
  supabase: any,
  userId: string,
  request: GetStepImagesRequest,
  startTime: number
): Promise<Response> {
  const { run_id, step_id, upload_ids, step_index, quality_preference = "2K", ratio = "16:9" } = request;

  // RULE: Max images per step
  if (upload_ids.length > RULE_GATES.MAX_IMAGES_PER_STEP) {
    return jsonError(`Maximum ${RULE_GATES.MAX_IMAGES_PER_STEP} images per step`, 400);
  }

  if (upload_ids.length === 0) {
    return jsonError("No upload_ids provided", 400);
  }

  // RULE: Steps 0-3 ALWAYS use 2K
  const effective_quality: QualityTier = RULE_GATES.STEP_QUALITY_OVERRIDE[step_index] || quality_preference;

  // Fetch all uploads with metadata
  const { data: uploads, error } = await supabase
    .from("uploads")
    .select(`
      id, bucket, path, owner_id, 
      original_width, original_height, size_bytes, file_hash, mime_type,
      preview_upload_id, is_preview
    `)
    .in("id", upload_ids);

  if (error) {
    return jsonError("Failed to fetch uploads", 500);
  }

  const images: ImageIOImage[] = [];
  const validationErrors: string[] = [];

  for (const uploadId of upload_ids) {
    const upload = uploads?.find((u: any) => u.id === uploadId);
    
    if (!upload) {
      validationErrors.push(`Upload ${uploadId} not found`);
      continue;
    }

    if (upload.owner_id !== userId) {
      validationErrors.push(`Unauthorized access to upload ${uploadId}`);
      continue;
    }

    // RULE: Check file size limits
    if (upload.size_bytes && upload.size_bytes > RULE_GATES.MAX_ORIGINAL_SIZE_BYTES) {
      validationErrors.push(`Upload ${uploadId} exceeds ${RULE_GATES.MAX_ORIGINAL_SIZE_BYTES / (1024*1024)}MB limit`);
      continue;
    }

    // RULE: Check mime type
    if (upload.mime_type && !RULE_GATES.ALLOWED_MIME_TYPES.includes(upload.mime_type)) {
      validationErrors.push(`Upload ${uploadId} has invalid mime type: ${upload.mime_type}`);
      continue;
    }

    // Generate preview URL
    const { data: previewUrlData, error: previewError } = await supabase.storage
      .from(upload.bucket)
      .createSignedUrl(upload.path, RULE_GATES.URL_EXPIRY_SECONDS);

    if (previewError) {
      validationErrors.push(`Failed to sign preview URL for ${uploadId}`);
      continue;
    }

    // Generate original URL (same for now, could be different bucket)
    const { data: originalUrlData } = await supabase.storage
      .from(upload.bucket)
      .createSignedUrl(upload.path, RULE_GATES.URL_EXPIRY_SECONDS);

    // Determine role based on kind or step context
    let role: ImageRole = "input";
    if (upload.is_preview) role = "preview";
    
    // CRITICAL: Verify no base64 in URLs
    if (previewUrlData.signedUrl.startsWith('data:')) {
      validationErrors.push(`FORBIDDEN: base64 URL detected for ${uploadId}`);
      continue;
    }

    images.push({
      upload_id: uploadId,
      role,
      preview_url: previewUrlData.signedUrl,
      original_url: originalUrlData?.signedUrl || null,
      width: upload.original_width || 0,
      height: upload.original_height || 0,
      filesize_bytes: upload.size_bytes || 0,
      mime_type: upload.mime_type || "image/jpeg",
      sha256_hash: upload.file_hash || "unknown"
    });
  }

  // If any validation errors, return them
  if (validationErrors.length > 0 && images.length === 0) {
    return jsonError(`Validation errors: ${validationErrors.join("; ")}`, 400);
  }

  // Build strict ImageIOOutput
  const output: ImageIOOutput = {
    run_id,
    step_id,
    images,
    quality_used: effective_quality,
    ratio_used: ratio,
    created_at: new Date().toISOString()
  };

  // Self-validate output against schema rules
  const selfValidation = validateImageIOOutputInternal(output, step_index);
  if (!selfValidation.valid) {
    console.error("[get_step_images] Self-validation failed:", selfValidation.errors);
    return jsonError(`Schema validation failed: ${selfValidation.errors.join("; ")}`, 500);
  }

  console.log(`[get_step_images] SUCCESS: ${images.length} images, quality=${effective_quality}, took ${Date.now() - startTime}ms`);

  return jsonSuccess({
    ...output,
    validation_warnings: validationErrors.length > 0 ? validationErrors : undefined,
    processing_time_ms: Date.now() - startTime
  });
}

/**
 * Internal validation for ImageIOOutput
 */
function validateImageIOOutputInternal(
  output: ImageIOOutput, 
  stepIndex: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!output.run_id) errors.push("Missing run_id");
  if (!output.step_id) errors.push("Missing step_id");
  if (!output.images || !Array.isArray(output.images)) errors.push("Missing or invalid images array");
  if (!output.quality_used) errors.push("Missing quality_used");
  if (!output.ratio_used) errors.push("Missing ratio_used");
  if (!output.created_at) errors.push("Missing created_at");

  // RULE: Steps 0-3 must use 2K
  const expectedQuality = RULE_GATES.STEP_QUALITY_OVERRIDE[stepIndex];
  if (expectedQuality && output.quality_used !== expectedQuality) {
    errors.push(`Step ${stepIndex} requires ${expectedQuality}, got ${output.quality_used}`);
  }

  // RULE: Max images
  if (output.images.length > RULE_GATES.MAX_IMAGES_PER_STEP) {
    errors.push(`Too many images: ${output.images.length} > ${RULE_GATES.MAX_IMAGES_PER_STEP}`);
  }

  // RULE: No base64 in URLs
  for (const img of output.images) {
    if (img.preview_url.startsWith('data:')) {
      errors.push(`FORBIDDEN: base64 preview_url for ${img.upload_id}`);
    }
    if (img.original_url?.startsWith('data:')) {
      errors.push(`FORBIDDEN: base64 original_url for ${img.upload_id}`);
    }
    if (!img.preview_url.startsWith('https://')) {
      errors.push(`Invalid preview_url for ${img.upload_id}: must be https://`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// UTILITIES
// ============================================================================

function jsonSuccess(data: any): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Extract image dimensions from file header (supports PNG, JPEG, WebP)
 * Uses progressive/header-only parsing - doesn't load full image into memory
 */
function getImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  try {
    // Check PNG signature
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      // PNG: width at bytes 16-19, height at bytes 20-23 (big endian)
      const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
      const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
      return { width, height };
    }

    // Check JPEG signature
    if (data[0] === 0xFF && data[1] === 0xD8) {
      let offset = 2;
      while (offset < data.length - 8) {
        if (data[offset] !== 0xFF) break;
        const marker = data[offset + 1];
        
        // SOF markers (Start of Frame)
        if ((marker >= 0xC0 && marker <= 0xC3) || 
            (marker >= 0xC5 && marker <= 0xC7) ||
            (marker >= 0xC9 && marker <= 0xCB) ||
            (marker >= 0xCD && marker <= 0xCF)) {
          const height = (data[offset + 5] << 8) | data[offset + 6];
          const width = (data[offset + 7] << 8) | data[offset + 8];
          return { width, height };
        }
        
        // Skip to next marker
        const length = (data[offset + 2] << 8) | data[offset + 3];
        offset += 2 + length;
      }
    }

    // Check WebP signature
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
      // VP8 format
      if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x20) {
        const width = ((data[26] | (data[27] << 8)) & 0x3FFF);
        const height = ((data[28] | (data[29] << 8)) & 0x3FFF);
        return { width, height };
      }
      // VP8L format
      if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x4C) {
        const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
        const width = (bits & 0x3FFF) + 1;
        const height = ((bits >> 14) & 0x3FFF) + 1;
        return { width, height };
      }
    }

    return null;
  } catch (e) {
    console.error("[getImageDimensions] Error:", e);
    return null;
  }
}
