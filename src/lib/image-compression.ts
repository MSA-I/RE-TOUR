/**
 * Client-Side Image Compression for Floor Plans
 *
 * Automatically resize and compress floor plan images before upload to prevent
 * Edge Function memory exhaustion. Target: <= 10MB, preferably 6-8MB.
 */

export interface CompressionResult {
  success: boolean;
  compressedFile: File | null;
  error?: string;
  metrics: CompressionMetrics;
}

export interface CompressionMetrics {
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  compressedSize: number;
  compressedWidth: number;
  compressedHeight: number;
  compressionRatio: number;
  finalQuality: number;
  format: string;
  attempts: number;
  timeTaken: number;
}

export interface CompressionOptions {
  maxFileSizeMB?: number;
  targetFileSizeMB?: number;
  maxDimension?: number;
  initialQuality?: number;
  minQuality?: number;
  qualityStep?: number;
  outputFormat?: "jpeg" | "webp";
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxFileSizeMB: 10,
  targetFileSizeMB: 8,
  maxDimension: 2400, // 2200-2600px range, using middle value
  initialQuality: 0.8,
  minQuality: 0.6,
  qualityStep: 0.1,
  outputFormat: "jpeg",
};

/**
 * Load image file into an HTMLImageElement
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
 * Calculate new dimensions while preserving aspect ratio
 */
function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number
): { width: number; height: number } {
  const longestSide = Math.max(originalWidth, originalHeight);

  if (longestSide <= maxDimension) {
    return { width: originalWidth, height: originalHeight };
  }

  const scale = maxDimension / longestSide;
  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * Resize and compress image using Canvas API
 */
function resizeAndCompress(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
  format: "jpeg" | "webp"
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return reject(new Error("Failed to get canvas context"));
    }

    // Use high-quality scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw resized image
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to blob
    const mimeType = format === "webp" ? "image/webp" : "image/jpeg";
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob"));
        }
      },
      mimeType,
      quality
    );
  });
}

/**
 * Check if WebP is supported
 */
function isWebPSupported(): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
}

/**
 * Compress floor plan image with progressive quality reduction
 *
 * Strategy:
 * 1. Resize to maxDimension if needed
 * 2. Start with initialQuality (0.8)
 * 3. If size > target, reduce quality by qualityStep (0.1) and retry
 * 4. Stop if quality < minQuality (0.6) or size <= target
 * 5. Return compressed file or error
 */
export async function compressFloorPlanImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const startTime = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check if WebP is supported, fall back to JPEG if not
  const outputFormat = opts.outputFormat === "webp" && !isWebPSupported()
    ? "jpeg"
    : opts.outputFormat;

  const maxFileSizeBytes = opts.maxFileSizeMB * 1024 * 1024;
  const targetFileSizeBytes = opts.targetFileSizeMB * 1024 * 1024;

  try {
    // Load image
    const img = await loadImage(file);
    const originalWidth = img.width;
    const originalHeight = img.height;
    const originalSize = file.size;

    console.log(`[ImageCompress] Original: ${originalWidth}x${originalHeight}, ${(originalSize / (1024 * 1024)).toFixed(2)}MB`);

    // Check if file is already small enough
    if (originalSize <= targetFileSizeBytes) {
      console.log("[ImageCompress] File already within target size, skipping compression");
      return {
        success: true,
        compressedFile: file,
        metrics: {
          originalSize,
          originalWidth,
          originalHeight,
          compressedSize: originalSize,
          compressedWidth: originalWidth,
          compressedHeight: originalHeight,
          compressionRatio: 1,
          finalQuality: 1,
          format: file.type,
          attempts: 0,
          timeTaken: performance.now() - startTime,
        },
      };
    }

    // Calculate target dimensions
    const { width, height } = calculateDimensions(
      originalWidth,
      originalHeight,
      opts.maxDimension
    );

    console.log(`[ImageCompress] Target dimensions: ${width}x${height}`);

    // Progressive quality reduction
    let quality = opts.initialQuality;
    let attempts = 0;
    let bestBlob: Blob | null = null;
    let bestSize = Infinity;

    while (quality >= opts.minQuality) {
      attempts++;

      console.log(`[ImageCompress] Attempt ${attempts}: quality=${quality.toFixed(2)}`);

      const blob = await resizeAndCompress(img, width, height, quality, outputFormat);
      const size = blob.size;

      console.log(`[ImageCompress] Result: ${(size / (1024 * 1024)).toFixed(2)}MB`);

      // Track best result
      if (size < bestSize) {
        bestBlob = blob;
        bestSize = size;
      }

      // Check if we hit target
      if (size <= targetFileSizeBytes) {
        console.log(`[ImageCompress] ✓ Target reached at quality=${quality.toFixed(2)}`);
        break;
      }

      // Check if we exceeded max
      if (size > maxFileSizeBytes) {
        console.log(`[ImageCompress] ⚠ Still above max size, reducing quality...`);
      }

      // Reduce quality for next attempt
      quality -= opts.qualityStep;
    }

    // Check final result
    if (!bestBlob) {
      return {
        success: false,
        compressedFile: null,
        error: "Failed to compress image",
        metrics: {
          originalSize,
          originalWidth,
          originalHeight,
          compressedSize: 0,
          compressedWidth: 0,
          compressedHeight: 0,
          compressionRatio: 0,
          finalQuality: 0,
          format: outputFormat,
          attempts,
          timeTaken: performance.now() - startTime,
        },
      };
    }

    if (bestSize > maxFileSizeBytes) {
      return {
        success: false,
        compressedFile: null,
        error: `Unable to compress below ${opts.maxFileSizeMB}MB without degrading readability. Current: ${(bestSize / (1024 * 1024)).toFixed(2)}MB. Please resize the image manually.`,
        metrics: {
          originalSize,
          originalWidth,
          originalHeight,
          compressedSize: bestSize,
          compressedWidth: width,
          compressedHeight: height,
          compressionRatio: originalSize / bestSize,
          finalQuality: quality + opts.qualityStep, // Last successful quality
          format: outputFormat,
          attempts,
          timeTaken: performance.now() - startTime,
        },
      };
    }

    // Success! Convert blob to file
    const extension = outputFormat === "webp" ? "webp" : "jpg";
    const originalName = file.name.replace(/\.[^.]+$/, "");
    const compressedFile = new File(
      [bestBlob],
      `${originalName}_compressed.${extension}`,
      { type: bestBlob.type }
    );

    // VALIDATION: Verify compressed file is not corrupted
    if (compressedFile.size === 0) {
      console.error("[ImageCompress] Compressed file is 0 bytes - corruption detected");
      return {
        success: false,
        compressedFile: null,
        error: "Compression produced invalid file (0 bytes). Try a different image.",
        metrics: {
          originalSize,
          originalWidth,
          originalHeight,
          compressedSize: 0,
          compressedWidth: width,
          compressedHeight: height,
          compressionRatio: 0,
          finalQuality: quality + opts.qualityStep,
          format: outputFormat,
          attempts,
          timeTaken: performance.now() - startTime,
        },
      };
    }

    // VALIDATION: Verify the compressed image can be loaded
    try {
      const testImg = await loadImage(compressedFile);
      if (!testImg.width || !testImg.height) {
        throw new Error("Image dimensions are invalid");
      }
      console.log(`[ImageCompress] Validation: Compressed image loads successfully (${testImg.width}x${testImg.height})`);
    } catch (validationError) {
      console.error("[ImageCompress] Compressed image failed validation:", validationError);
      return {
        success: false,
        compressedFile: null,
        error: "Compressed image failed validation. The image may be corrupted. Try a different image.",
        metrics: {
          originalSize,
          originalWidth,
          originalHeight,
          compressedSize: bestSize,
          compressedWidth: width,
          compressedHeight: height,
          compressionRatio: originalSize / bestSize,
          finalQuality: quality + opts.qualityStep,
          format: outputFormat,
          attempts,
          timeTaken: performance.now() - startTime,
        },
      };
    }

    const timeTaken = performance.now() - startTime;
    const compressionRatio = originalSize / bestSize;

    console.log(`[ImageCompress] ✓ Success!`);
    console.log(`[ImageCompress] Original: ${(originalSize / (1024 * 1024)).toFixed(2)}MB → Compressed: ${(bestSize / (1024 * 1024)).toFixed(2)}MB`);
    console.log(`[ImageCompress] Ratio: ${compressionRatio.toFixed(2)}x, Quality: ${(quality + opts.qualityStep).toFixed(2)}, Time: ${timeTaken.toFixed(0)}ms`);

    return {
      success: true,
      compressedFile,
      metrics: {
        originalSize,
        originalWidth,
        originalHeight,
        compressedSize: bestSize,
        compressedWidth: width,
        compressedHeight: height,
        compressionRatio,
        finalQuality: quality + opts.qualityStep,
        format: outputFormat,
        attempts,
        timeTaken,
      },
    };
  } catch (error) {
    const timeTaken = performance.now() - startTime;
    return {
      success: false,
      compressedFile: null,
      error: error instanceof Error ? error.message : "Unknown compression error",
      metrics: {
        originalSize: file.size,
        originalWidth: 0,
        originalHeight: 0,
        compressedSize: 0,
        compressedWidth: 0,
        compressedHeight: 0,
        compressionRatio: 0,
        finalQuality: 0,
        format: outputFormat,
        attempts: 0,
        timeTaken,
      },
    };
  }
}

/**
 * Format compression metrics for logging
 */
export function formatCompressionMetrics(metrics: CompressionMetrics): Record<string, unknown> {
  return {
    original_size_mb: (metrics.originalSize / (1024 * 1024)).toFixed(2),
    original_dimensions: `${metrics.originalWidth}x${metrics.originalHeight}`,
    compressed_size_mb: (metrics.compressedSize / (1024 * 1024)).toFixed(2),
    compressed_dimensions: `${metrics.compressedWidth}x${metrics.compressedHeight}`,
    compression_ratio: metrics.compressionRatio.toFixed(2),
    final_quality: metrics.finalQuality.toFixed(2),
    format: metrics.format,
    attempts: metrics.attempts,
    time_taken_ms: Math.round(metrics.timeTaken),
  };
}
