"use client";

import { useEffect, useRef, useState } from "react";
import {
  SkylineMosaic,
  type SkylineMosaicMode,
  type Effect,
  type Transition,
  type DitherShape,
} from "skyline-mosaic";

const INSTALL_CMD = "npm i skyline-mosaic";
const PLAYGROUND_KEY = "skyline-playground";

// Film grain overlay — the ethereal wash needs tooth or it reads as plastic.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Night keeps its depth but picks up faint ethereal auras — violet high
// on the right, a whisper of teal near the base.
const NIGHT_BG = [
  "radial-gradient(ellipse 60% 50% at 82% 8%, rgba(109,86,192,0.34), transparent 65%)",
  "radial-gradient(ellipse 46% 38% at 22% 30%, rgba(64,88,190,0.2), transparent 70%)",
  "radial-gradient(ellipse 70% 38% at 50% 100%, rgba(214,140,80,0.12), transparent 72%)",
  "radial-gradient(ellipse 50% 42% at 8% 88%, rgba(52,140,128,0.16), transparent 70%)",
  "linear-gradient(to bottom, #05050a 0%, #0a0a16 40%, #11101f 75%, #050507 100%)",
].join(", ");
// Azure day sky with a warm haze at the horizon — landing on near-white was
// washing out the pastel day palette of the skyline.
const DAY_BG = [
  "radial-gradient(ellipse 70% 50% at 75% 85%, rgba(255,214,170,0.55), transparent 70%)",
  "radial-gradient(ellipse 55% 45% at 12% 18%, rgba(122,180,255,0.45), transparent 70%)",
  "linear-gradient(155deg, #4f9ede 0%, #6fb3e9 22%, #93c8ef 45%, #b9dcf2 65%, #e8d9c3 88%, #f2e3cb 100%)",
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
          on
            ? isNight
              ? "bg-zinc-500"
              : "bg-zinc-900"
            : isNight
              ? "bg-white/[0.14]"
              : "bg-black/[0.12]"
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

function CopyChip({
  isNight,
  size = "full",
}: {
  isNight: boolean;
  size?: "full" | "auto";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(INSTALL_CMD);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={`group inline-flex h-9 ${size === "full" ? "w-full" : "w-fit"} cursor-pointer items-center justify-center gap-2.5 rounded-[10px] border px-3 font-mono text-[12.5px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
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

/** True the first time the element crosses into the viewport, then sticks. */
function useInViewOnce<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/** Fades content up the first time it scrolls into view. */
function Reveal({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>(0.3);
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${
        inView ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/**
 * Use-case figure that arms its skyline the first time it scrolls into view,
 * so each build-in plays as the visitor reaches it. `delay` staggers cards
 * that arrive together; the ↻ in the caption replays just that card.
 */
function UseCase({
  index,
  label,
  delay = 0,
  night,
  className,
  cardClassName,
  renderSkyline,
  children,
}: {
  index: string;
  label: string;
  delay?: number;
  night: boolean;
  className?: string;
  cardClassName?: string;
  renderSkyline: () => React.ReactNode;
  children: React.ReactNode;
}) {
  const { ref, inView } = useInViewOnce<HTMLElement>(0.3);
  const [armed, setArmed] = useState(false);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setArmed(true), delay);
    return () => clearTimeout(t);
  }, [inView, delay]);

  return (
    <figure
      ref={ref}
      className={`transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none ${
        inView ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className ?? ""}`}
    >
      <ExampleCard
        night={night}
        className={cardClassName}
        skyline={
          armed ? (
            <div key={replay} className="absolute inset-0">
              {renderSkyline()}
            </div>
          ) : null
        }
      >
        {/* card copy holds back until the skyline is underway */}
        <div
          className="relative h-full transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none"
          style={{
            opacity: armed ? 1 : 0,
            transform: armed ? "none" : "translateY(10px)",
            transitionDelay: armed ? "650ms" : "0ms",
          }}
        >
          {children}
        </div>
      </ExampleCard>
      <figcaption className="mt-2.5 flex items-baseline gap-2 px-1 font-mono text-[11px]">
        <span className="text-zinc-600">{index}</span>
        <span className="text-zinc-400">{label}</span>
        <button
          type="button"
          onClick={() => setReplay((r) => r + 1)}
          className="ml-auto shrink-0 cursor-pointer text-zinc-600 transition-colors duration-150 hover:text-zinc-300"
        >
          ↻ replay
        </button>
      </figcaption>
    </figure>
  );
}

export default function Showcase() {
  const [mode, setMode] = useState<SkylineMosaicMode>("night");
  const [effect, setEffect] = useState<Effect>("mosaic");
  const [transition, setTransition] = useState<Transition>("dissolve");
  const [shape, setShape] = useState<DitherShape>("square");
  const [twinkle, setTwinkle] = useState(true);
  const [fog, setFog] = useState(false);
  const [clouds, setClouds] = useState(true);
  const [cellGap, setCellGap] = useState<"0" | "1" | "2" | "3">("1");
  const [replay, setReplay] = useState(0);
  const [systemDark, setSystemDark] = useState(false);
  // Mobile only: panel starts collapsed so the skyline stays visible.
  const [panelOpen, setPanelOpen] = useState(false);

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

  // Remember playground settings across refreshes.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLAYGROUND_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.mode) setMode(s.mode);
        if (s.effect) setEffect(s.effect);
        if (s.transition) setTransition(s.transition);
        if (s.shape) setShape(s.shape);
        if (typeof s.twinkle === "boolean") setTwinkle(s.twinkle);
        if (typeof s.fog === "boolean") setFog(s.fog);
        if (typeof s.clouds === "boolean") setClouds(s.clouds);
        if (s.cellGap) setCellGap(s.cellGap);
      }
    } catch {}
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(
        PLAYGROUND_KEY,
        JSON.stringify({ mode, effect, transition, shape, twinkle, fog, clouds, cellGap })
      );
    } catch {}
  }, [mode, effect, transition, shape, twinkle, fog, clouds, cellGap]);

  const isNight = mode === "night" || (mode === "auto" && systemDark);

  useEffect(() => {
    document.body.style.backgroundColor = isNight ? "#09090b" : "#ffffff";
    return () => {
      document.body.style.backgroundColor = "";
    };
  }, [isNight]);

  return (
    <div
      className={`font-sans transition-colors duration-700 ${
        isNight ? "bg-zinc-950 text-zinc-100" : "bg-white text-zinc-900"
      }`}
    >
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

      {/* film grain over everything — part of the ethereal treatment */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-[100] mix-blend-overlay transition-opacity duration-700 ${
          isNight ? "opacity-[0.1]" : "opacity-[0.06]"
        }`}
        style={{ backgroundImage: GRAIN }}
      />

      {/* ---- hero playground: text over skyline; bg capped at half-screen on phone ---- */}
      <section
        id="playground"
        className="relative overflow-hidden transition-colors duration-700 max-lg:min-h-[50svh] lg:min-h-svh"
      >
        <div
          className="absolute inset-x-0 top-0 max-lg:h-[50svh] lg:inset-0"
          style={{ background: isNight ? NIGHT_BG : DAY_BG }}
        >
          <SkylineMosaic
            key={`${transition}-${replay}`}
            mode={mode}
            effect={effect}
            transition={transition}
            twinkle={twinkle}
            fog={fog}
            clouds={clouds}
            cellGap={Number(cellGap)}
            dither={{ shape }}
            style={{ position: "absolute", inset: 0 }}
          />
        </div>

        <div className="relative z-10 flex flex-col gap-8 p-6 md:p-10 lg:block">
          {/* headline — top-left, like a real hero */}
          <header className="showcase-up max-w-[720px]">
            <div
              className={`mb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-700 ${
                isNight ? "text-zinc-400" : "text-zinc-500"
              }`}
            >
              an animated skyline for react
            </div>
            <h1
              className={`text-balance text-[clamp(28px,3.6vw,42px)] leading-[1.1] tracking-[-0.01em] transition-colors duration-700 [font-family:var(--font-young-serif)] ${
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
              Day and night palettes, blooming windows, dither and halftone —
              tuned to sit quietly behind real content.
            </p>
            <div className="mt-4">
              <CopyChip isNight={isNight} size="auto" />
            </div>
          </header>

          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="playground-controls"
            onClick={() => setPanelOpen((v) => !v)}
            className={`showcase-up inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-full border px-4 font-mono text-[12px] backdrop-blur-xl transition-colors duration-500 [animation-delay:120ms] lg:hidden ${
              isNight
                ? "border-white/[0.12] bg-zinc-900/70 text-zinc-200"
                : "border-black/[0.08] bg-white/70 text-zinc-800"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 4.5h7M13.5 4.5H14M2 11.5h.5M7 11.5h7" />
              <circle cx="11" cy="4.5" r="1.8" />
              <circle cx="4.5" cy="11.5" r="1.8" />
            </svg>
            {panelOpen ? "hide controls" : "customize"}
          </button>

          {/* control panel — floats top-right on desktop, in-flow on mobile */}
          <aside
            id="playground-controls"
            className={`showcase-up w-full max-w-[420px] rounded-2xl border p-4 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-500 [animation-delay:120ms] lg:absolute lg:top-10 lg:right-10 lg:block lg:w-[288px] ${
              panelOpen ? "max-lg:block" : "max-lg:hidden"
            } ${
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
                v0.6.0
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
              <ToggleRow label="Clouds (day)" on={clouds} onChange={setClouds} isNight={isNight} />
            </div>

            <button
              type="button"
              onClick={() => setReplay((r) => r + 1)}
              className={`h-9 cursor-pointer rounded-[10px] text-[13px] font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${isNight ? "bg-white/[0.08] text-zinc-200 hover:bg-white/[0.13]" : "bg-black/[0.06] text-zinc-700 hover:bg-black/[0.09]"}`}
            >
              Replay build-in
            </button>
            </div>
          </aside>
        </div>

        <a
          href="#examples"
          aria-label="Scroll to use cases"
          className={`absolute left-1/2 z-10 -translate-x-1/2 animate-bounce transition-colors motion-reduce:animate-none max-lg:top-[calc(50svh-2.5rem)] lg:bottom-6 ${
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
        <Reveal className="mb-8">
          <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            use cases
          </div>
          <h2
            className={`text-[clamp(24px,2.6vw,32px)] leading-[1.12] tracking-[-0.005em] transition-colors duration-700 [font-family:var(--font-young-serif)] ${
              isNight ? "text-zinc-50" : "text-zinc-900"
            }`}
          >
            Where it fits.
          </h2>
          <p
            className={`mt-2 max-w-[56ch] text-pretty text-[14px] leading-relaxed transition-colors duration-700 ${
              isNight ? "text-zinc-400" : "text-zinc-600"
            }`}
          >
            Same component, three different effects — each card builds itself
            in as you reach it.
          </p>
        </Reveal>

        <div className="grid grid-cols-6 gap-5">
          <UseCase
            index="01"
            label="404 page"
            night
            className="col-span-4 max-md:col-span-6"
            cardClassName="aspect-[2/1]"
            renderSkyline={() => (
              <SkylineMosaic
                mode="night"
                twinkle
                fog
                transition="rise"
                transitionDurationMs={2600}
                style={{ position: "absolute", inset: 0 }}
              />
            )}
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
          </UseCase>

          {/* weather widget — fills its cell so it aligns with the 404 card */}
          <UseCase
            index="02"
            label="weather widget"
            delay={180}
            night={false}
            className="col-span-2 flex flex-col max-md:col-span-6"
            cardClassName="flex-1 max-md:aspect-[2/1]"
            renderSkyline={() => (
              <SkylineMosaic
                mode="day"
                effect="halftone"
                clouds
                cellSize={5}
                transitionDurationMs={2200}
                style={{ position: "absolute", inset: 0 }}
              />
            )}
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
          </UseCase>

          <UseCase
            index="03"
            label="event banner"
            delay={120}
            night={false}
            className="col-span-6"
            cardClassName="aspect-[2.6/1] max-md:aspect-[1.6/1]"
            renderSkyline={() => (
              <SkylineMosaic
                mode="day"
                effect="dither"
                dither={{ shape: "diamond" }}
                clouds
                transition="sweep"
                transitionDurationMs={2600}
                style={{ position: "absolute", inset: 0 }}
              />
            )}
          >
            {/* soft scrim so the copy reads over the buildings */}
            <div className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-[#9fd0f0]/70 via-[#9fd0f0]/25 to-transparent" />
            <div className="relative flex h-full flex-col items-start justify-start gap-3 p-7 md:p-9">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-700">
                June 12–14 · Moscone West
              </div>
              <div className="max-w-[480px] text-balance font-mono text-[clamp(19px,2.2vw,28px)] font-medium leading-[1.12] tracking-[-0.03em] text-zinc-900">
                The JavaScript conference above the fog.
              </div>
              <div className="mt-1 rounded-full bg-zinc-900 px-4 py-1.5 text-[12.5px] font-medium text-zinc-50">
                Get tickets →
              </div>
            </div>
          </UseCase>
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer
        className={`border-t py-10 text-center font-mono text-[11.5px] transition-colors duration-700 ${
          isNight
            ? "border-white/[0.06] text-zinc-600"
            : "border-black/[0.08] text-zinc-500"
        }`}
      >
        skyline-mosaic · MIT · npm i skyline-mosaic
      </footer>
    </div>
  );
}
