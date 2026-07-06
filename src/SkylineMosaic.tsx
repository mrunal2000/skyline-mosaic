"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  SkylineEngine,
  type DitherOptions,
  type Effect,
  type ResolvedMode,
  type Transition,
} from "./engine";
import { resolveScene, type SceneImages, type SceneName } from "./scenes";

export type SkylineMosaicMode = "day" | "night" | "auto";
export type {
  Effect,
  Transition,
  DitherOptions,
  DitherShape,
  DitherGrid,
} from "./engine";
export type { SceneName, SceneImages } from "./scenes";

const DEFAULT_CELL_RATIO = 4 / 1600;
const NIGHT_GLOW = "rgba(20, 14, 35, 0.5)";

const DEFAULT_DITHER: Required<DitherOptions> = {
  grid: "4x4",
  shape: "square",
  levels: 4,
};

export type SkylineMosaicProps = {
  /**
   * `"day"` | `"night"` | `"auto"`. `"auto"` follows the OS
   * `prefers-color-scheme`. Defaults to `"day"`.
   */
  mode?: SkylineMosaicMode;
  /**
   * Which skyline to render: a built-in scene name (`"sf"`) or a custom
   * `{ day, night? }` pair of image sources. Defaults to `"sf"`.
   */
  scene?: SceneName | SceneImages;
  /** Rendering style: `"mosaic"` (default), `"dither"`, or `"shimmer"`. */
  effect?: Effect;
  /** Ordered-dithering options, used when `effect="dither"`. */
  dither?: DitherOptions;
  /** How the reveal is choreographed: `"dissolve"` (default), `"sweep"`, `"rise"`. */
  transition?: Transition;
  /** Length of the build-in / mode-change reveal, in ms. Defaults to 2000. */
  transitionDurationMs?: number;
  /** At night, lit windows gently flicker with ambient life. Defaults to false. */
  twinkle?: boolean;
  /** Volumetric fog bank drifting through the skyline (day and night). Defaults to false. */
  fog?: boolean;
  /** Drifting clouds in the day sky; the cursor gently parts them. Defaults to false. */
  clouds?: boolean;
  /** Content rendered behind the mosaic (e.g. a gradient or shader sky). */
  sky?: ReactNode;
  /** Override the day-mode image (takes precedence over `scene`). */
  dayImageSrc?: string;
  /** Override the night-mode image (takes precedence over `scene`). */
  nightImageSrc?: string;
  /** Fixed pixel size of each mosaic square. Overrides `cellSizeRatio`. */
  cellSize?: number;
  /** Square size as a fraction of container width. Defaults to ~4px @ 1600px. */
  cellSizeRatio?: number;
  /**
   * Gap between squares in px. Defaults to 1 — the signature mosaic-grid
   * texture. Set 0 for solid pixels.
   */
  cellGap?: number;
  /** Height of the night glow gradient as a fraction of container height (0–1). */
  glowHeightRatio?: number;
  /** Pause rendering while scrolled offscreen. Defaults to true. */
  pauseWhenOffscreen?: boolean;
  className?: string;
  style?: CSSProperties;
};

function prefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
function resolveMode(mode: SkylineMosaicMode): ResolvedMode {
  if (mode === "auto") return prefersDark() ? "night" : "day";
  return mode;
}

/**
 * An animated pixel-mosaic rendering of a city skyline, with day/night
 * palettes, a bloom around lit windows, and optional twinkle and
 * dither/shimmer effects.
 *
 * Sizes itself to its container — give the wrapper a height (e.g. `100vh` for a
 * hero or `300px` for a card). Renders as a `pointer-events: none` backdrop, so
 * put real content as a sibling/child with `position: relative` and a higher
 * `zIndex`.
 */
export default function SkylineMosaic({
  mode = "day",
  scene,
  effect = "mosaic",
  dither,
  transition = "dissolve",
  transitionDurationMs = 2000,
  twinkle = false,
  fog = false,
  clouds = false,
  sky,
  dayImageSrc,
  nightImageSrc,
  cellSize,
  cellSizeRatio = DEFAULT_CELL_RATIO,
  cellGap = 1,
  glowHeightRatio = 0.9,
  pauseWhenOffscreen = true,
  className,
  style,
}: SkylineMosaicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SkylineEngine | null>(null);
  const resolvedRef = useRef<ResolvedMode>(resolveMode(mode));

  const resolvedScene = scene ? resolveScene(scene) : resolveScene(undefined);
  const daySrc = dayImageSrc ?? resolvedScene.day;
  const nightSrc = nightImageSrc ?? resolvedScene.night;
  const ditherOpts: Required<DitherOptions> = { ...DEFAULT_DITHER, ...dither };

  // Create engine once; option changes are pushed via setOptions below.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const reducedMotion = prefersReducedMotion();
    const engine = new SkylineEngine(canvas, {
      mode: resolveMode(mode),
      dayImageSrc: daySrc,
      nightImageSrc: nightSrc,
      effect,
      dither: ditherOpts,
      cellSize,
      cellSizeRatio,
      cellGap,
      transition,
      transitionDurationMs,
      twinkle: twinkle && !reducedMotion,
      fog,
      clouds,
      reducedMotion,
    });
    engineRef.current = engine;
    resolvedRef.current = resolveMode(mode);

    let visible = !document.hidden;
    let onscreen = true;
    const sync = () => {
      if (visible && onscreen) engine.resume();
      else engine.pause();
    };

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(container);

    let io: IntersectionObserver | undefined;
    if (pauseWhenOffscreen && "IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          onscreen = entries[0]?.isIntersecting ?? true;
          sync();
        },
        { threshold: 0 }
      );
      io.observe(container);
    }

    const onVisibility = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Follow OS color-scheme changes when in auto mode.
    const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => {
      if (mode === "auto") {
        const next = prefersDark() ? "night" : "day";
        resolvedRef.current = next;
        engine.setMode(next);
      }
    };
    darkQuery?.addEventListener?.("change", onScheme);

    return () => {
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      darkQuery?.removeEventListener?.("change", onScheme);
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push mode changes.
  useEffect(() => {
    const next = resolveMode(mode);
    resolvedRef.current = next;
    engineRef.current?.setMode(next);
  }, [mode]);

  // Push non-structural + structural option changes.
  useEffect(() => {
    engineRef.current?.setOptions({
      dayImageSrc: daySrc,
      nightImageSrc: nightSrc,
      effect,
      dither: ditherOpts,
      cellSize,
      cellSizeRatio,
      cellGap,
      transition,
      transitionDurationMs,
      twinkle: twinkle && !prefersReducedMotion(),
      fog,
      clouds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    daySrc,
    nightSrc,
    effect,
    ditherOpts.grid,
    ditherOpts.shape,
    ditherOpts.levels,
    cellSize,
    cellSizeRatio,
    cellGap,
    transition,
    transitionDurationMs,
    twinkle,
    fog,
    clouds,
  ]);

  const isNight = resolveMode(mode) === "night";

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        pointerEvents: "none",
        ...style,
      }}
    >
      {sky != null && (
        <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>{sky}</div>
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
          height: `${glowHeightRatio * 100}%`,
          // Softness is baked into the gradient stops — a 40px blur filter on
          // a viewport-sized layer is needlessly expensive.
          background: `radial-gradient(ellipse 75% 115% at 50% 100%, ${NIGHT_GLOW}, rgba(20,14,35,0.24) 45%, transparent 76%)`,
          opacity: isNight ? 1 : 0,
          transition: "opacity 600ms ease",
        }}
      />
      {/* fog is rendered inside the canvas by the engine, so it drifts
          through the buildings instead of sliding over them as a sheet */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, zIndex: 2 }}
      />
    </div>
  );
}
