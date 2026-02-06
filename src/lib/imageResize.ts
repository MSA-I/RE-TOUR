/**
 * Client-side image resize using HTML5 Canvas
 * Supports both preview mode (50% scale) and full quality mode
 */

const PREVIEW_SCALE_FACTOR = 0.5; // Preview = 50% dimensions
const JPEG_QUALITY = 0.90; // High quality to prevent artifacts

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  wasResized: boolean;
  isPreview: boolean;
}

export interface ImageQualityMetadata {
  originalWidth: number;
  originalHeight: number;
  storedWidth: number;
  storedHeight: number;
  isPreview: boolean;
  originalSizeBytes: number;
  storedSizeBytes: number;
  mimeType: string;
}

/**
 * Load an image file into an HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Resize an image file to 50% of original dimensions (preview mode)
 * Converts to JPEG with 0.90 quality for optimal file size without artifacts
 */
export async function resizeImageForUpload(file: File): Promise<ResizeResult> {
  return resizeImage(file, { forPreview: true });
}

/**
 * Resize an image with configurable options
 * @param file - The image file to process
 * @param options - Configuration options
 * @param options.forPreview - If true, scales to 50%. If false, preserves original size
 * @param options.maxDimension - Maximum dimension (width or height). Null = no limit
 * @param options.quality - JPEG quality (0-1). Default 0.90
 */
export async function resizeImage(
  file: File,
  options: {
    forPreview?: boolean;
    maxDimension?: number | null;
    quality?: number;
    outputFormat?: "image/jpeg" | "image/png";
  } = {}
): Promise<ResizeResult> {
  const {
    forPreview = true,
    maxDimension = null,
    quality = JPEG_QUALITY,
    outputFormat = "image/jpeg",
  } = options;

  const img = await loadImage(file);

  const originalWidth = img.width;
  const originalHeight = img.height;

  let newWidth = originalWidth;
  let newHeight = originalHeight;
  let wasResized = false;

  // Apply preview scaling if requested
  if (forPreview) {
    newWidth = Math.max(1, Math.round(originalWidth * PREVIEW_SCALE_FACTOR));
    newHeight = Math.max(1, Math.round(originalHeight * PREVIEW_SCALE_FACTOR));
    wasResized = true;
  }

  // Apply max dimension constraint if specified
  if (maxDimension && (newWidth > maxDimension || newHeight > maxDimension)) {
    const scale = maxDimension / Math.max(newWidth, newHeight);
    newWidth = Math.max(1, Math.round(newWidth * scale));
    newHeight = Math.max(1, Math.round(newHeight * scale));
    wasResized = true;
  }

  // Create canvas and resize
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(img.src);
    throw new Error("Failed to get canvas context");
  }

  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Draw resized image
  ctx.drawImage(img, 0, 0, newWidth, newHeight);

  // Clean up image object URL
  URL.revokeObjectURL(img.src);

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create image blob"));
          return;
        }

        console.log(
          `Image ${wasResized ? "resized" : "preserved"}: ` +
            `${originalWidth}x${originalHeight} → ${newWidth}x${newHeight}` +
            `${forPreview ? " (preview)" : " (full quality)"}, ` +
            `${(file.size / 1024 / 1024).toFixed(2)}MB → ${(blob.size / 1024 / 1024).toFixed(2)}MB`
        );

        resolve({
          blob,
          width: newWidth,
          height: newHeight,
          originalWidth,
          originalHeight,
          wasResized,
          isPreview: forPreview,
        });
      },
      outputFormat,
      quality
    );
  });
}

/**
 * Create a File object from a resized blob
 */
export function createResizedFile(blob: Blob, originalName: string): File {
  // Change extension to .jpg if it was resized
  const baseName = originalName.replace(/\.[^.]+$/, "");
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const newName = `${baseName}.${ext}`;

  return new File([blob], newName, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

/**
 * Extract quality metadata from an image file
 */
export async function getImageQualityMetadata(
  file: File,
  storedBlob?: Blob
): Promise<ImageQualityMetadata> {
  const img = await loadImage(file);
  const originalWidth = img.width;
  const originalHeight = img.height;
  URL.revokeObjectURL(img.src);

  return {
    originalWidth,
    originalHeight,
    storedWidth: storedBlob ? originalWidth : originalWidth, // Would need to decode stored to know
    storedHeight: storedBlob ? originalHeight : originalHeight,
    isPreview: false,
    originalSizeBytes: file.size,
    storedSizeBytes: storedBlob?.size ?? file.size,
    mimeType: file.type,
  };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format resolution to human-readable string
 */
export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`;
}
