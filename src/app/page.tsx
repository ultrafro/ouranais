import Player from "@/components/Player";
import { manifest } from "@/lib/config";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-neutral-950 px-4 py-10 sm:py-16">
      <header className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {manifest.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
          The source video carries burned-in French subtitles only. This player
          reads them off the picture, re-times them, and renders a selectable
          track on top — so you can watch in the language you prefer.
        </p>
      </header>

      <Player manifest={manifest} />

      <footer className="w-full max-w-5xl text-xs leading-relaxed text-white/35">
        <p>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">space</kbd>{" "}
          play/pause ·{" "}
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">←</kbd>{" "}
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">→</kbd> seek
          5s ·{" "}
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">c</kbd>{" "}
          toggle subtitles
        </p>
      </footer>
    </main>
  );
}
