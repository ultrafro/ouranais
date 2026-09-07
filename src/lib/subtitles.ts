export type Cue = {
  /** start time in seconds */
  s: number;
  /** end time in seconds */
  e: number;
  /** cue text; "\n" separates rendered lines */
  t: string;
};

export type LanguageEntry = {
  code: string;
  /** English name, e.g. "French" */
  label: string;
  /** endonym, e.g. "Français" */
  native: string;
  /** true for the language OCR'd directly off the burned-in subtitles */
  source?: boolean;
};

export type Manifest = {
  videoId: string;
  title: string;
  /** vertical band (in source-video pixel rows) occupied by the burned-in subtitles */
  hardsubBand?: { top: number; height: number; videoHeight: number };
  languages: LanguageEntry[];
};

const cache = new Map<string, Cue[]>();

export async function loadCues(code: string): Promise<Cue[]> {
  const hit = cache.get(code);
  if (hit) return hit;
  const res = await fetch(`/subtitles/${code}.json`);
  if (!res.ok) throw new Error(`No subtitle track for "${code}" (${res.status})`);
  const cues = (await res.json()) as Cue[];
  cues.sort((a, b) => a.s - b.s);
  cache.set(code, cues);
  return cues;
}

/**
 * Index of the cue active at time `t`, or -1.
 * Binary search on start time, then walk back over any overlapping cues.
 */
export function activeCueIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let cand = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].s <= t) {
      cand = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = cand; i >= 0 && i > cand - 8; i--) {
    if (t >= cues[i].s && t < cues[i].e) return i;
  }
  return -1;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
