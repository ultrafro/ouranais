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
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isFs, setIsFs] = useState(false);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const defaultLang = manifest.languages[0]?.code ?? OFF;
  const [lang, setLang] = useState<string>(defaultLang);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cueError, setCueError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);

  /**
   * "above" stacks our line just over the burned-in original and draws no mask
   * at all — nothing covers picture, which is the cheapest fix for the band of
   * black the mask used to add. "cover" paints over the original instead, for
   * when seeing two sets of subtitles is more distracting than losing the strip.
   */
  const [placement, setPlacement] = useState<"above" | "cover">("above");
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
          // Hide YouTube's own fullscreen button. It would take the *iframe*
          // fullscreen, leaving our overlay behind in the page — subtitles
          // would simply vanish. Ours fullscreens the wrapper instead.
          fs: 0,
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

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen?.();
  }, []);

  /* Track fullscreen from the document, so Esc and the browser's own controls
     keep our state honest rather than only our button. */
  useEffect(() => {
    const sync = () => setIsFs(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
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
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, defaultLang, toggleFullscreen]);

  const band = manifest.hardsubBand;
  const maskStyle = band
    ? {
        bottom: `${(1 - (band.top + band.height) / band.videoHeight) * 100}%`,
        height: `${(band.height / band.videoHeight) * 100}%`,
      }
    : null;

  // Sit just clear of the top of the burned-in band, or low in the letterbox
  // when we are covering it instead.
  const overlayBottom =
    placement === "above" && band
      ? `${(1 - band.top / band.videoHeight) * 100 + 1.5}%`
      : "8%";

  return (
    <div className="w-full max-w-5xl">
      {/* The shell is what goes fullscreen. The stage inside keeps a strict 16:9
          box so our percentage-positioned overlay stays aligned to the picture
          at any screen shape. */}
      <div
        ref={shellRef}
        className={
          isFs ? "flex h-full w-full items-center justify-center bg-black" : ""
        }
      >
        <div
          className={`relative aspect-video overflow-hidden bg-black ${
            isFs ? "" : "w-full rounded-xl shadow-2xl ring-1 ring-white/10"
          }`}
          style={{
            containerType: "size",
            // Fit the screen while holding 16:9 exactly. Sizing by height with
            // max-width instead lets the clamp win on a wider screen and
            // silently squashes the box out of ratio, which slides the overlay
            // off the picture it is supposed to sit against.
            ...(isFs
              ? { width: "min(100vw, calc(100vh * 16 / 9))", height: "auto" }
              : {}),
          }}
        >
        <div ref={hostRef} className="absolute inset-0 h-full w-full" />

        {/* Opaque strip covering the burned-in subtitles.
            Only while a cue is actually on screen — our cues were read off the
            burned-in ones, so they share timings, and masking permanently would
            black out real picture for the ~85% of the film with no subtitle. */}
        {placement === "cover" && maskStyle && line && (
          <div
            className="pointer-events-none absolute inset-x-0 bg-black"
            style={maskStyle}
            aria-hidden
          />
        )}

        {/* Our own subtitle overlay */}
        {line && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-[6%]"
            style={{ bottom: overlayBottom }}
          >
            <p
              lang={lang}
              dir={lang === "ar" ? "rtl" : "auto"}
              className="whitespace-pre-line rounded-md bg-black/55 px-3 py-1 text-center font-medium leading-snug text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.9)]"
              // cqw is a share of the stage, not the window, so the text keeps
              // its proportion to the picture when we go fullscreen.
              style={{
                fontSize: `clamp(0.75rem, ${2.5 * size}cqw, ${4 * size}rem)`,
              }}
            >
              {line}
            </p>
          </div>
        )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-[#141010]/80 px-4 py-3 ring-1 ring-white/[0.08]">
        <button
          onClick={toggle}
          disabled={!ready}
          className="rounded-md bg-sand px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-white disabled:opacity-40"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <span className="font-mono text-xs tabular-nums text-ochre/75">
          {formatTime(time)} / {formatTime(duration)}
        </span>

        <label className="flex items-center gap-2 text-sm text-sand-dim">
          Subtitles
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded-md border border-white/12 bg-[#0f0c0b] px-2 py-1 text-sm text-sand outline-none transition focus:border-ochre/50"
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

        <label className="flex items-center gap-2 text-sm text-sand-dim">
          Position
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as "above" | "cover")}
            className="rounded-md border border-white/12 bg-[#0f0c0b] px-2 py-1 text-sm text-sand outline-none transition focus:border-ochre/50"
          >
            <option value="above">Above original</option>
            <option value="cover">Cover original</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-sand-dim">
          Size
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.05}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24 accent-ochre"
          />
        </label>

        <button
          onClick={toggleFullscreen}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-sm text-sand-dim transition hover:border-ochre/40 hover:text-sand"
          title="Fullscreen (f)"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden>
            {isFs ? (
              <path d="M6 1H5v4H1v1h5V1zm4 0h1v4h4v1h-5V1zM1 10h5v5H5v-4H1v-1zm9 0h5v1h-4v4h-1v-5z" />
            ) : (
              <path d="M1 1h5v1H2v4H1V1zm9 0h5v5h-1V2h-4V1zM1 10h1v4h4v1H1v-5zm13 0h1v5h-5v-1h4v-4z" />
            )}
          </svg>
          {isFs ? "Exit" : "Fullscreen"}
        </button>
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
