"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadYouTubeAPI, PlayerState, type YTPlayer } from "@/lib/youtube";
import {
  activeCueIndex,
  formatTime,
  loadCues,
  type Cue,
  type Manifest,
} from "@/lib/subtitles";

const OFF = "off";

export default function Player({ manifest }: { manifest: Manifest }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const rafRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const defaultLang = manifest.languages[0]?.code ?? OFF;
  const [lang, setLang] = useState<string>(defaultLang);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cueError, setCueError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);

  const [maskHardsubs, setMaskHardsubs] = useState(true);
  const [size, setSize] = useState(1);

  /* ---- create the YouTube player once ---- */
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId: manifest.videoId,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          cc_load_policy: 0,
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            if (cancelled) return;
            setReady(true);
            setDuration(e.target.getDuration());
            // ?t=SECONDS deep-links to a moment, so a cue can be pointed at.
            const t = Number(
              new URLSearchParams(window.location.search).get("t")
            );
            if (Number.isFinite(t) && t > 0) e.target.seekTo(t, true);
          },
          onStateChange: (e: { data: number }) => {
            setPlaying(e.data === PlayerState.PLAYING);
            if (e.data === PlayerState.PLAYING && playerRef.current) {
              setDuration(playerRef.current.getDuration());
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [manifest.videoId]);

  /* ---- drive the clock from the player, once per animation frame ---- */
  useEffect(() => {
    const tick = () => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === "function") setTime(p.getCurrentTime());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ---- swap subtitle track ---- */
  useEffect(() => {
    let cancelled = false;
    setCueError(null);
    if (lang === OFF) {
      setCues([]);
      setLine(null);
      return;
    }
    loadCues(lang)
      .then((c) => {
        if (!cancelled) setCues(c);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setCues([]);
        setCueError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  /* ---- pick the active cue ---- */
  useEffect(() => {
    if (!cues.length) {
      setLine(null);
      return;
    }
    const i = activeCueIndex(cues, time);
    setLine(i === -1 ? null : cues[i].t);
  }, [cues, time]);

  const seek = useCallback((to: number) => {
    playerRef.current?.seekTo(Math.max(0, to), true);
  }, []);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState() === PlayerState.PLAYING) p.pauseVideo();
    else p.playVideo();
  }, []);

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === "Space" || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek((playerRef.current?.getCurrentTime() ?? 0) - 5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek((playerRef.current?.getCurrentTime() ?? 0) + 5);
      } else if (e.key === "c") {
        setLang((l) => (l === OFF ? defaultLang : OFF));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, defaultLang]);

  const band = manifest.hardsubBand;
  const maskStyle = band
    ? {
        bottom: `${(1 - (band.top + band.height) / band.videoHeight) * 100}%`,
        height: `${(band.height / band.videoHeight) * 100}%`,
      }
    : null;

  return (
    <div className="w-full max-w-5xl">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
        <div ref={hostRef} className="absolute inset-0 h-full w-full" />

        {/* Opaque strip covering the burned-in subtitles.
            Only while a cue is actually on screen — our cues were read off the
            burned-in ones, so they share timings, and masking permanently would
            black out real picture for the ~85% of the film with no subtitle. */}
        {maskHardsubs && maskStyle && line && (
          <div
            className="pointer-events-none absolute inset-x-0 bg-black"
            style={maskStyle}
            aria-hidden
          />
        )}

        {/* Our own subtitle overlay */}
        {line && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[8%] flex justify-center px-[6%]">
            <p
              className="whitespace-pre-line rounded-md bg-black/55 px-3 py-1 text-center font-medium leading-snug text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.9)]"
              style={{ fontSize: `clamp(0.8rem, ${2.4 * size}vw, ${2.2 * size}rem)` }}
            >
              {line}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
        <button
          onClick={toggle}
          disabled={!ready}
          className="rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-white/85 disabled:opacity-40"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <span className="font-mono text-xs tabular-nums text-white/60">
          {formatTime(time)} / {formatTime(duration)}
        </span>

        <label className="flex items-center gap-2 text-sm text-white/80">
          Subtitles
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded-md border border-white/15 bg-neutral-900 px-2 py-1 text-sm text-white outline-none focus:border-white/40"
          >
            {manifest.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
                {l.source ? " (source)" : ""}
              </option>
            ))}
            <option value={OFF}>Off</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={maskHardsubs}
            onChange={(e) => setMaskHardsubs(e.target.checked)}
            className="accent-white"
          />
          Hide burned-in subtitles
        </label>

        <label className="flex items-center gap-2 text-sm text-white/80">
          Size
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.05}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24 accent-white"
          />
        </label>
      </div>

      {cueError && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/25">
          {cueError} — generate a track by running{" "}
          <code className="font-mono text-amber-100">pipeline/extract_subtitles.py</code>{" "}
          against your own copy of the video (see the README).
        </p>
      )}
    </div>
  );
}
