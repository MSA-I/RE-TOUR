export const ASPECT_RATIOS = {
  "1:1": { label: "Square", shortLabel: "1:1" },
  "4:3": { label: "Standard", shortLabel: "4:3" },
  "3:4": { label: "Portrait", shortLabel: "3:4" },
  "16:9": { label: "Widescreen", shortLabel: "16:9" },
  "9:16": { label: "Portrait", shortLabel: "9:16" },
  "3:2": { label: "Classic", shortLabel: "3:2" },
  "2:3": { label: "Portrait", shortLabel: "2:3" },
  "2:1": { label: "Panoramic", shortLabel: "2:1" },
  "21:9": { label: "Ultra-wide", shortLabel: "21:9" },
  "5:4": { label: "Photo", shortLabel: "5:4" },
  "4:5": { label: "Portrait", shortLabel: "4:5" }
} as const;

export type AspectRatioType = keyof typeof ASPECT_RATIOS;

export const RATIO_OPTIONS = Object.keys(ASPECT_RATIOS) as AspectRatioType[];
