export const MULTI_PANO_CATEGORIES = [
  "merge",
  "stitching",
  "alignment",
  "exposure",
  "artifact-fix",
  "safety",
] as const;

export type MultiPanoCategory = (typeof MULTI_PANO_CATEGORIES)[number];

export interface PanoSuggestion {
  id: string;
  category: MultiPanoCategory;
  title: string;
  prompt: string;
  is_generated: boolean;
  created_at: string;
}

const FIXED_DATE = "2024-03-20T00:00:00.000Z";

export const MULTI_PANO_SUGGESTIONS: PanoSuggestion[] = [
  {
    id: "mp-1",
    category: "merge",
    title: "Merge two panoramas",
    prompt: "Merge two panoramas into one seamless equirectangular panorama",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-2",
    category: "stitching",
    title: "Stitch using overlap",
    prompt: "Stitch panoramas using overlap only, no hallucinated areas",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-3",
    category: "alignment",
    title: "Align horizon/verticals",
    prompt: "Align horizon and vertical lines before blending",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-4",
    category: "exposure",
    title: "Match exposure/WB",
    prompt: "Match exposure and white balance between panoramas",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-5",
    category: "artifact-fix",
    title: "Fix seam line",
    prompt: "Fix visible seam line at overlap region",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-6",
    category: "artifact-fix",
    title: "Reduce ghosting",
    prompt: "Reduce ghosting/parallax artifacts in overlap",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-7",
    category: "safety",
    title: "Preserve geometry",
    prompt: "Preserve geometry: keep doors/windows/walls consistent across both sides",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-8",
    category: "safety",
    title: "Neutral unknown areas",
    prompt: "Keep unknown areas neutral (do not invent rooms/openings)",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-9",
    category: "safety",
    title: "Maintain 360 continuity",
    prompt: "Maintain 360 continuity: left/right edge must match perfectly",
    is_generated: false,
    created_at: FIXED_DATE,
  },
  {
    id: "mp-10",
    category: "safety",
    title: "True 2:1 output",
    prompt: "Output must remain true 2:1 equirectangular (or chosen ratio), with no stretching",
    is_generated: false,
    created_at: FIXED_DATE,
  },
];

export const MULTI_PANO_CATEGORY_LABELS: Record<MultiPanoCategory, string> = {
  merge: "Merge",
  stitching: "Stitching",
  alignment: "Alignment",
  exposure: "Exposure",
  "artifact-fix": "Artifact Fix",
  safety: "Safety",
};
