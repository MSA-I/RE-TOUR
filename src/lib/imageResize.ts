/**
 * Client-side image resize using HTML5 Canvas
 * Always resizes images to 50% dimensions and converts to JPEG at 0.90 quality
 */

const SCALE_FACTOR = 0.5; // Always resize to 50%
const JPEG_QUALITY = 0.90; // High quality to prevent artifacts

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  wasResized: boolean;
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
 * Resize an image file to 50% of original dimensions
 * Converts to JPEG with 0.90 quality for optimal file size without artifacts
 */
export async function resizeImageForUpload(file: File): Promise<ResizeResult> {
  const img = await loadImage(file);

  const originalWidth = img.width;
  const originalHeight = img.height;

  // Always downscale to 50%
  const newWidth = Math.max(1, Math.round(originalWidth * SCALE_FACTOR));
  const newHeight = Math.max(1, Math.round(originalHeight * SCALE_FACTOR));
  
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
  
  // Convert to JPEG blob with high quality
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create image blob"));
          return;
        }
        
        console.log(
          `Image resized: ${originalWidth}x${originalHeight} → ${newWidth}x${newHeight} (50%), ` +
          `${(file.size / 1024 / 1024).toFixed(2)}MB → ${(blob.size / 1024 / 1024).toFixed(2)}MB`
        );
        
        resolve({
          blob,
          width: newWidth,
          height: newHeight,
          originalWidth,
          originalHeight,
          wasResized: true
        });
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

/**
 * Create a File object from a resized blob
 */
export function createResizedFile(blob: Blob, originalName: string): File {
  // Change extension to .jpg if it was resized
  const baseName = originalName.replace(/\.[^.]+$/, "");
  const newName = `${baseName}.jpg`;
  
  return new File([blob], newName, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}
