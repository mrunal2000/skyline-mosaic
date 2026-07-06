"use client";

import { useEffect, useState } from "react";
import {
  SkylineMosaic,
  type SkylineMosaicMode,
  type Effect,
  type Transition,
  type DitherShape,
} from "skyline-mosaic";

const INSTALL_CMD = "npm i skyline-mosaic";

const NIGHT_BG =
  "linear-gradient(to bottom, #05050a 0%, #0a0a16 40%, #11101f 75%, #050507 100%)";
// Deeper azure up top, warm haze at the horizon — landing on near-white was
// washing out the pastel day palette of the skyline.
const DAY_BG = [
  "radial-gradient(ellipse 70% 45% at 72% 82%, rgba(255,243,209,0.5), transparent 72%)",
  "linear-gradient(to bottom, #74b9e8 0%, #a3d2f0 45%, #cfe7f6 78%, #e9e4d8 100%)",
].join(", ");

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  labels,
  isNight,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  isNight: boolean;
}) {
  return (
    <div
      className={`flex rounded-[10px] p-[3px] transition-colors duration-500 ${
        isNight ? "bg-white/[0.06]" : "bg-black/[0.06]"
      }`}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`h-8 min-w-0 flex-1 cursor-pointer rounded-[7px] px-1 text-[12px] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96] ${
              active
                ? "bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                : isNight
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  on,
  onChange,
  isNight,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  isNight: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex h-9 w-full cursor-pointer items-center justify-between rounded-lg px-1 transition-[background-color] duration-150 ease-out ${
        isNight ? "hover:bg-white/[0.04]" : "hover:bg-black/[0.04]"
      }`}
    >
      <span
        className={`text-[13px] font-medium transition-colors duration-500 ${
          isNight ? "text-zinc-300" : "text-zinc-700"
        }`}
      >
        {label}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-[background-color] duration-200 ease-out ${
          on ? "bg-amber-400/90" : isNight ? "bg-white/[0.14]" : "bg-black/[0.12]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out ${
            on ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function CopyChip({ isNight }: { isNight: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(INSTALL_CMD);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={`group inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2.5 rounded-[10px] border px-3 font-mono text-[12.5px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
        isNight
          ? "border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
          : "border-black/[0.1] bg-white/50 text-zinc-800 hover:bg-white/75"
      }`}
    >
      <span className="select-none opacity-45">$</span>
      {INSTALL_CMD}
      <span className="relative size-3.5">
        {/* copy / check cross-fade — both stay in the DOM */}
        <svg
          viewBox="0 0 16 16"
          className={`absolute inset-0 transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] ${
            copied ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-60 blur-0"
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1.5" />
        </svg>
        <svg
          viewBox="0 0 16 16"
          className={`absolute inset-0 text-emerald-400 transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] ${
            copied ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      </span>
    </button>
  );
}

/** Rounded scene card used by the use-case mockups. */
function ExampleCard({
  night,
  className,
  children,
  skyline,
}: {
  night: boolean;
  className?: string;
  children: React.ReactNode;
  skyline: React.ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl outline outline-1 -outline-offset-1 outline-white/10 ${className ?? ""}`}
      style={{
        background: night ? NIGHT_BG : DAY_BG,
        boxShadow: "0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.35)",
      }}
    >
      <div className="absolute inset-0">{skyline}</div>
      <div className="pointer-events-none relative z-10 h-full">{children}</div>
    </div>
  );
}

export default function Showcase() {
  const [mode, setMode] = useState<SkylineMosaicMode>("night");
  const [effect, setEffect] = useState<Effect>("mosaic");
  const [transition, setTransition] = useState<Transition>("dissolve");
  const [shape, setShape] = useState<DitherShape>("square");
  const [twinkle, setTwinkle] = useState(true);
  const [fog, setFog] = useState(false);
  const [cellGap, setCellGap] = useState<"0" | "1" | "2" | "3">("1");
  const [replay, setReplay] = useState(0);
  const [systemDark, setSystemDark] = useState(false);

  // Resolve "auto" the same way the component does, so the page background
  // always matches the palette the skyline actually renders.
  useEffect(() => {
    const q = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!q) return;
    setSystemDark(q.matches);
    const onChange = () => setSystemDark(q.matches);
    q.addEventListener?.("change", onChange);
    return () => q.removeEventListener?.("change", onChange);
  }, []);

  const isNight = mode === "night" || (mode === "auto" && systemDark);

  return (
    <div className="bg-zinc-950 font-sans text-zinc-100">
      <style>{`
        html { scroll-behavior: smooth; }
        @keyframes showcase-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .showcase-up { animation: showcase-up 500ms cubic-bezier(0.215, 0.61, 0.355, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          .showcase-up { animation: none; }
        }
      `}</style>

      {/* ---- hero playground: full-screen skyline, knobs on top ---- */}
      <section
        className="relative min-h-svh overflow-hidden transition-colors duration-700"
        style={{ background: isNight ? NIGHT_BG : DAY_BG }}
      >
        <SkylineMosaic
          key={`${transition}-${replay}`}
          mode={mode}
          effect={effect}
          transition={transition}
          twinkle={twinkle}
          fog={fog}
          cellGap={Number(cellGap)}
          dither={{ shape }}
          style={{ position: "absolute", inset: 0 }}
        />

        <div className="relative z-10 flex flex-col gap-8 p-6 md:p-10 lg:block">
          {/* headline — top-left, like a real hero */}
          <header className="showcase-up max-w-[720px]">
            <div
              className={`mb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-700 ${
                isNight ? "text-zinc-400" : "text-zinc-500"
              }`}
            >
              react · canvas · one component
            </div>
            <h1
              className={`text-balance text-[clamp(30px,4vw,46px)] leading-[1.05] tracking-[-0.015em] transition-colors duration-700 [font-family:var(--font-instrument-serif)] ${
                isNight
                  ? "text-zinc-50 [text-shadow:0_2px_30px_rgba(0,0,0,0.55)]"
                  : "text-zinc-900"
              }`}
            >
              San Francisco, one square at a time.
            </h1>
            <p
              className={`mt-2.5 max-w-[56ch] text-pretty text-[14.5px] leading-relaxed transition-colors duration-700 ${
                isNight ? "text-zinc-400" : "text-zinc-600"
              }`}
            >
              An animated pixel-mosaic skyline for your hero, header, or 404.
              Day and night palettes, blooming windows, dither and shimmer —
              tuned to sit quietly behind real content.
            </p>
          </header>

          {/* control panel — floats top-right on the scene */}
          <aside
            className={`showcase-up w-[288px] rounded-2xl border p-4 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-500 [animation-delay:120ms] max-lg:w-full max-lg:max-w-[420px] lg:absolute lg:top-10 lg:right-10 ${
              isNight
                ? "border-white/[0.09] bg-zinc-900/70 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.35)]"
                : "border-black/[0.07] bg-white/[0.65] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.1)]"
            }`}
          >
            <div className="mb-4 flex items-baseline justify-between px-1">
              <span
                className={`font-mono text-[13px] font-medium tracking-tight transition-colors duration-500 ${
                  isNight ? "text-zinc-100" : "text-zinc-900"
                }`}
              >
                skyline-mosaic
              </span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  isNight ? "text-zinc-500" : "text-zinc-400"
                }`}
              >
                v0.4.0
              </span>
            </div>

            <div className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5 px-1">
                <MicroLabel>Mode</MicroLabel>
                <Segmented
                  value={mode}
                  options={["day", "night", "auto"] as const}
                  onChange={setMode}
                  isNight={isNight}
                />
                {/* fixed-height hint so switching modes never shifts the panel */}
                <p className="h-4 text-[11px] leading-4 text-zinc-500">
                  {mode === "auto"
                    ? `follows your OS appearance — ${systemDark ? "dark" : "light"} right now`
                    : mode === "night"
                      ? "always night"
                      : "always daytime"}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 px-1">
                <MicroLabel>Effect</MicroLabel>
                <Segmented
                  value={effect}
                  options={["mosaic", "dither", "halftone"] as const}
                  onChange={setEffect}
                  isNight={isNight}
                />
              </div>

              {/* always mounted so the panel never changes height */}
              <div
                aria-disabled={effect !== "dither"}
                className={`flex flex-col gap-1.5 px-1 transition-opacity duration-200 ${
                  effect === "dither" ? "" : "pointer-events-none opacity-35"
                }`}
              >
                <MicroLabel>Dither shape</MicroLabel>
                <Segmented
                  value={shape}
                  options={["square", "circle", "diamond", "dot"] as const}
                  onChange={setShape}
                  isNight={isNight}
                />
              </div>

              <div className="flex flex-col gap-1.5 px-1">
                <MicroLabel>Transition</MicroLabel>
                <Segmented
                  value={transition}
                  options={["dissolve", "sweep", "rise"] as const}
                  onChange={setTransition}
                  isNight={isNight}
                />
              </div>

              <div className="flex flex-col gap-1.5 px-1">
                <MicroLabel>Cell gap</MicroLabel>
                <Segmented
                  value={cellGap}
                  options={["0", "1", "2", "3"] as const}
                  onChange={setCellGap}
                  labels={{ "0": "0px", "1": "1px", "2": "2px", "3": "3px" }}
                  isNight={isNight}
                />
              </div>

              <div className={`mx-1 h-px transition-colors duration-500 ${isNight ? "bg-white/[0.08]" : "bg-black/[0.07]"}`} />

              <div className="flex flex-col">
                <ToggleRow label="Window twinkle" on={twinkle} onChange={setTwinkle} isNight={isNight} />
                <ToggleRow label="Fog" on={fog} onChange={setFog} isNight={isNight} />
              </div>

              <button
                type="button"
                onClick={() => setReplay((r) => r + 1)}
                className={`h-9 cursor-pointer rounded-[10px] text-[13px] font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${isNight ? "bg-white/[0.08] text-zinc-200 hover:bg-white/[0.13]" : "bg-black/[0.06] text-zinc-700 hover:bg-black/[0.09]"}`}
              >
                Replay build-in
              </button>

              <CopyChip isNight={isNight} />
            </div>
          </aside>
        </div>

        <a
          href="#examples"
          aria-label="Scroll to use cases"
          className={`absolute bottom-6 left-1/2 z-10 -translate-x-1/2 animate-bounce transition-colors motion-reduce:animate-none ${
            isNight
              ? "text-zinc-500 hover:text-zinc-300"
              : "text-zinc-400 hover:text-zinc-600"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 7.5 10 13.5 16 7.5" />
          </svg>
        </a>
      </section>

      {/* ---- use cases ---- */}
      <section id="examples" className="mx-auto max-w-[1172px] scroll-mt-8 px-6 py-24">
        <div className="mb-8">
          <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            use cases
          </div>
          <h2 className="text-[clamp(26px,3vw,36px)] leading-[1.08] tracking-[-0.01em] text-zinc-50 [font-family:var(--font-instrument-serif)]">
            Where it fits.
          </h2>
          <p className="mt-2 max-w-[56ch] text-pretty text-[14px] leading-relaxed text-zinc-400">
            Three drop-in ideas — each card is the component with different
            props behind ordinary content.
          </p>
        </div>

        <div className="grid grid-cols-6 gap-5">
          {/* 404 page */}
          <figure className="col-span-4 max-md:col-span-6">
            <ExampleCard
              night
              className="aspect-[2/1]"
              skyline={
                <SkylineMosaic
                  mode="night"
                  twinkle
                  fog
                  transition="rise"
                  style={{ position: "absolute", inset: 0 }}
                />
              }
            >
              <div className="flex h-full flex-col items-center justify-center pb-[8%] text-center">
                <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-zinc-500">
                  404
                </div>
                <div className="mt-2 text-[clamp(22px,2.6vw,32px)] text-zinc-100 [font-family:var(--font-instrument-serif)] [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">
                  Lost in the fog.
                </div>
                <div className="mt-4 rounded-full border border-white/[0.16] bg-white/[0.06] px-4 py-1.5 text-[12.5px] text-zinc-300 backdrop-blur-sm">
                  ← Back to the mainland
                </div>
              </div>
            </ExampleCard>
            <figcaption className="mt-2.5 px-1 font-mono text-[11px] text-zinc-600">
              404 page · {'mode="night" fog twinkle transition="rise"'}
            </figcaption>
          </figure>

          {/* weather widget — fills its cell so it aligns with the 404 card */}
          <figure className="col-span-2 flex flex-col max-md:col-span-6">
            <ExampleCard
              night={false}
              className="flex-1 max-md:aspect-[2/1]"
              skyline={
                <SkylineMosaic
                  mode="day"
                  cellSize={3}
                  cellGap={1}
                  style={{ position: "absolute", inset: 0 }}
                />
              }
            >
              <div className="flex h-full flex-col p-5 text-zinc-800">
                <div className="text-[12.5px] font-medium text-zinc-600">
                  San Francisco
                </div>
                <div className="text-[46px] font-light leading-tight tracking-[-0.02em] tabular-nums">
                  61°
                </div>
                <div className="text-[11.5px] text-zinc-500">
                  Clear · H 64° L 54°
                </div>
              </div>
            </ExampleCard>
            <figcaption className="mt-2.5 px-1 font-mono text-[11px] text-zinc-600">
              widget · {'mode="day" cellSize={3}'}
            </figcaption>
          </figure>


          {/* event banner */}
          <figure className="col-span-6">
            <ExampleCard
              night={false}
              className="aspect-[2.6/1] max-md:aspect-[1.6/1]"
              skyline={
                <SkylineMosaic
                  mode="day"
                  transition="sweep"
                  style={{ position: "absolute", inset: 0 }}
                />
              }
            >
              {/* soft scrim so the copy reads over the buildings */}
              <div className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-[#9fd0f0]/70 via-[#9fd0f0]/25 to-transparent" />
              <div className="relative flex h-full flex-col items-start justify-start gap-3 p-7 md:p-9">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-700">
                  June 12–14 · Moscone West
                </div>
                <div className="max-w-[520px] text-balance text-[clamp(22px,2.6vw,34px)] leading-[1.08] text-zinc-900 [font-family:var(--font-instrument-serif)]">
                  The JavaScript conference above the fog.
                </div>
                <div className="mt-1 rounded-full bg-zinc-900 px-4 py-1.5 text-[12.5px] font-medium text-zinc-50">
                  Get tickets →
                </div>
              </div>
            </ExampleCard>
            <figcaption className="mt-2.5 px-1 font-mono text-[11px] text-zinc-600">
              event banner · {'mode="day" transition="sweep"'}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className="border-t border-white/[0.06] py-10 text-center font-mono text-[11.5px] text-zinc-600">
        skyline-mosaic · MIT · npm i skyline-mosaic
      </footer>
    </div>
  );
}
