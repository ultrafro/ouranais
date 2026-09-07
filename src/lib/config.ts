import type { Manifest } from "./subtitles";

/**
 * Which video to play, and which subtitle tracks to offer.
 *
 * Cue data lives in `public/subtitles/<code>.json` and is produced by
 * `pipeline/extract_subtitles.py`. The English translation is committed for the
 * site; other generated tracks remain local. See the README.
 */
export const manifest: Manifest = {
  videoId: "WwH_xMhKZ2c",
  title: "L'Oranais",

  /**
   * Vertical band the burned-in subtitles occupy, in source-video pixel rows.
   * Used to draw an opaque strip over them so they do not collide with the
   * overlay. Measured on the 1280x720 source; re-measure with
   * `extract_subtitles.py --calibrate` for a different video.
   */
  hardsubBand: { top: 544, height: 82, videoHeight: 720 },

  languages: [
    { code: "en", label: "English", native: "English" },
    { code: "fr", label: "French", native: "Français", source: true },
    { code: "es", label: "Spanish", native: "Español" },
    { code: "ar", label: "Arabic", native: "العربية" },
    { code: "de", label: "German", native: "Deutsch" },
  ],
};
