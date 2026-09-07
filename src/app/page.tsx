import Player from "@/components/Player";
import { manifest } from "@/lib/config";

const REPO_URL = "https://github.com/ultrafro/ouranais";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-4 py-10 sm:py-16">
      <header className="w-full max-w-5xl">
        <p className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-ochre/70">
          Oran · 1954—62
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-sand sm:text-3xl">
          {manifest.title}
        </h1>
        <div
          className="mt-3 h-px w-24 rule-fade"
          style={{ background: "linear-gradient(90deg, var(--ochre), transparent 70%)" }}
          aria-hidden
        />
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-sand-dim">
          The source video carries burned-in French subtitles only. This player
          reads them off the picture, re-times them, and renders a selectable
          track on top — so you can watch in the language you prefer.
        </p>
      </header>

      <Player manifest={manifest} />

      <footer className="w-full max-w-5xl border-t border-white/[0.07] pt-5 text-xs leading-relaxed text-sand-dim/70">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p>
            <kbd className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-sand-dim">
              space
            </kbd>{" "}
            play/pause ·{" "}
            <kbd className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-sand-dim">
              ←
            </kbd>{" "}
            <kbd className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-sand-dim">
              →
            </kbd>{" "}
            seek 5s ·{" "}
            <kbd className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-sand-dim">
              c
            </kbd>{" "}
            toggle subtitles
          </p>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group inline-flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5 text-sand-dim transition hover:border-ochre/40 hover:text-sand"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 fill-current opacity-70 transition group-hover:opacity-100"
              aria-hidden
            >
              <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Source on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
