/**
 * Camera Intent Templates (A-H)
 * Step 3 (spec): Camera Intent - Decision-Only Layer
 *
 * These templates define standard camera positions and viewing directions
 * for interior space rendering. Users select templates per space to define
 * camera intents deterministically.
 *
 * Authority: RETOUR – PIPELINE (UPDATED & LOCKED).txt
 * Date: 2026-02-10
 */

export type CameraTemplateId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export type ViewDirectionType =
  | 'into_space'
  | 'toward_adjacent'
  | 'at_threshold_inward'
  | 'at_threshold_outward'
  | 'corner'
  | 'feature'
  | 'angled'
  | 'elevated';

export interface CameraTemplate {
  id: CameraTemplateId;
  name: string;
  description: string;
  viewDirectionType: ViewDirectionType;
  typicalPlacement: string;
  requiresAdjacentSpace: boolean;
  eyeLevelHeight: string;
  fovRecommendation: string;
  usageNotes?: string;
}

export const CAMERA_TEMPLATES: Record<CameraTemplateId, CameraTemplate> = {
  A: {
    id: 'A',
    name: 'Into Space',
    description: 'Standing inside space, looking into the space',
    viewDirectionType: 'into_space',
    typicalPlacement: 'Near entrance or threshold, facing inward',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '80°',
    usageNotes: 'Most common template. Shows the interior from entry perspective.',
  },
  B: {
    id: 'B',
    name: 'Toward Adjacent Space',
    description: 'Standing in space, looking toward adjacent space through opening',
    viewDirectionType: 'toward_adjacent',
    typicalPlacement: 'Near opening/doorway, facing adjacent room',
    requiresAdjacentSpace: true,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '75°',
    usageNotes: 'Requires adjacent space selection. Shows spatial relationships between rooms.',
  },
  C: {
    id: 'C',
    name: 'At Threshold Inward',
    description: 'Standing at threshold, looking into the space',
    viewDirectionType: 'at_threshold_inward',
    typicalPlacement: 'At doorway, facing into room',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '70°',
    usageNotes: 'Entry perspective. Good for showing full room from doorway.',
  },
  D: {
    id: 'D',
    name: 'At Threshold Outward',
    description: 'Standing at threshold, looking toward adjacent space',
    viewDirectionType: 'at_threshold_outward',
    typicalPlacement: 'At doorway, facing out of room',
    requiresAdjacentSpace: true,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '70°',
    usageNotes: 'Exit perspective. Shows view from inside room looking out.',
  },
  E: {
    id: 'E',
    name: 'Corner View',
    description: 'Standing in corner, diagonal view of space',
    viewDirectionType: 'corner',
    typicalPlacement: 'Room corner, diagonal sightline',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '85°',
    usageNotes: 'Diagonal perspective. Good for showing room depth and layout.',
  },
  F: {
    id: 'F',
    name: 'Feature Focus',
    description: 'Positioned to highlight specific room feature',
    viewDirectionType: 'feature',
    typicalPlacement: 'Facing key feature (window, fireplace, island)',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '65°',
    usageNotes: 'Feature-centric view. Use to highlight architectural elements.',
  },
  G: {
    id: 'G',
    name: 'Angled View',
    description: 'Off-axis angle to show depth and spatial relationships',
    viewDirectionType: 'angled',
    typicalPlacement: '45° angle to main walls',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.5-1.7m',
    fovRecommendation: '80°',
    usageNotes: 'Angled perspective. Shows room with dynamic composition.',
  },
  H: {
    id: 'H',
    name: 'Elevated Perspective',
    description: 'Slightly elevated view to show layout',
    viewDirectionType: 'elevated',
    typicalPlacement: 'Higher vantage point (if architecturally valid)',
    requiresAdjacentSpace: false,
    eyeLevelHeight: '1.8-2.0m',
    fovRecommendation: '90°',
    usageNotes: 'Elevated view. Use for open-plan spaces or layout overview.',
  },
};

/**
 * Get templates that are suitable for a specific space type
 */
export function getRecommendedTemplatesForSpaceType(spaceType: string): CameraTemplateId[] {
  const normalizedType = spaceType.toLowerCase();

  // All templates are valid for all spaces, but some are more common
  const baseTemplates: CameraTemplateId[] = ['A', 'C', 'E'];

  // Feature-focused templates for special spaces
  if (normalizedType.includes('kitchen')) {
    return ['A', 'E', 'F']; // Feature focus for island/counters
  }

  if (normalizedType.includes('living') || normalizedType.includes('lounge')) {
    return ['A', 'E', 'G', 'H']; // Angled and elevated for open spaces
  }

  if (normalizedType.includes('bedroom')) {
    return ['A', 'C', 'E']; // Standard views
  }

  if (normalizedType.includes('bathroom')) {
    return ['A', 'C', 'F']; // Feature focus for fixtures
  }

  // Default: standard templates
  return baseTemplates;
}

/**
 * Get human-readable description for a template + space combination
 */
export function buildIntentDescription(
  template: CameraTemplate,
  spaceName: string,
  spaceType: string,
  targetSpaceName?: string
): string {
  let desc = `${template.name} in ${spaceName} (${spaceType}). `;
  desc += template.description + '. ';
  desc += `Eye level: ${template.eyeLevelHeight}, FOV: ${template.fovRecommendation}. `;

  if (targetSpaceName && template.requiresAdjacentSpace) {
    desc += `Looking toward ${targetSpaceName}.`;
  }

  return desc;
}
