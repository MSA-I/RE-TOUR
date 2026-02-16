/**
 * Test Images Catalog
 *
 * Centralized catalog of test images from A:\RE-TOUR-DOCS\טסטים
 * Handles Hebrew path encoding and provides type-safe image loading
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

// Base path with Hebrew characters
export const TEST_IMAGES_PATH = 'A:\\RE-TOUR-DOCS\\טסטים';

// Test image catalog organized by type
export const TEST_IMAGES = {
  panoramas: [
    'פנורמה מלאה.png',
    'panorama-2026-02-09T15_26_07.834Z.png',
  ],
  floorPlans: [
    'user-debug-planning.png',
    'תמונה מושלמת.jpg',
  ],
  designRefs: [
    'ComfyUI_01808_.png',
    'ComfyUI_01810_.png',
    'ComfyUI_01811_.png',
    'index-2.jpg',
    'job_001.jpg',
  ],
  outputs: [
    'pipeline_step4_output_v1.png',
    'edited-pipeline_step4_output_v1.png (1).png',
    'pipeline_step2_output_v1.png',
    'edit-c0bc3456-d732-4c45-bae8-39bed82a34a3-1768910495351.png',
  ],
  retourCreations: [
    'RETOUR_creation_06a19488_full.jpg',
    'RETOUR_creation_0a8c68ad_full.png',
    'RETOUR_creation_4b9b460b_full.png',
    'RETOUR_creation_60114412_full.jpg',
    'RETOUR_creation_608d6c02_full.jpg',
    'RETOUR_creation_a51225d3_full.jpg',
    'RETOUR_step1_step1-d2_full.jpg',
  ],
} as const;

/**
 * Get MIME type from filename extension
 */
function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Load a test image from the Hebrew path
 *
 * @param filename - Name of the image file (can include Hebrew characters)
 * @returns File object ready for upload
 *
 * @example
 * const image = await loadTestImage('תמונה מושלמת.jpg');
 * const upload = await uploadFile('floor_plans', path, image);
 */
export async function loadTestImage(filename: string): Promise<File> {
  const fullPath = join(TEST_IMAGES_PATH, filename);

  try {
    const buffer = await readFile(fullPath);
    const blob = new Blob([buffer]);
    const mimeType = getMimeTypeFromFilename(filename);

    return new File([blob], filename, { type: mimeType });
  } catch (error) {
    throw new Error(
      `Failed to load test image "${filename}" from ${TEST_IMAGES_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Load multiple test images at once
 *
 * @param filenames - Array of image filenames
 * @returns Array of File objects
 *
 * @example
 * const images = await loadTestImages([
 *   'ComfyUI_01808_.png',
 *   'ComfyUI_01810_.png'
 * ]);
 */
export async function loadTestImages(filenames: string[]): Promise<File[]> {
  return Promise.all(filenames.map(loadTestImage));
}

/**
 * Get a random test image of a specific type
 *
 * @param type - Type of image to get
 * @returns Random image filename from that category
 *
 * @example
 * const randomFloorPlan = getRandomTestImage('floorPlans');
 * const image = await loadTestImage(randomFloorPlan);
 */
export function getRandomTestImage(
  type: keyof typeof TEST_IMAGES
): string {
  const images = TEST_IMAGES[type];
  return images[Math.floor(Math.random() * images.length)];
}
