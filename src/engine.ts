// Framework-free rendering engine for the skyline mosaic. Owns the canvas,
// the cell grid, every effect, and the render-loop lifecycle. The React
// component (and future Vue/Svelte wrappers) are thin drivers over this.

export type ResolvedMode = "day" | "night";
export type Effect = "mosaic" | "dither" | "shimmer";
export type Transition = "dissolve" | "sweep" | "rise";
export type DitherShape = "square" | "circle" | "diamond" | "dot";
export type DitherGrid = "2x2" | "4x4" | "8x8";

export type DitherOptions = {
  grid?: DitherGrid;
  shape?: DitherShape;
  levels?: number;
};

export type EngineOptions = {
  mode: ResolvedMode;
  dayImageSrc: string;
  nightImageSrc?: string;
  effect: Effect;
  dither: Required<DitherOptions>;
  cellSize?: number;
  cellSizeRatio: number;
  cellGap: number;
  transition: Transition;
  transitionDurationMs: number;
  twinkle: boolean;
  fog: boolean;
  reducedMotion: boolean;
};

const MIN_CELL_SIZE = 2;
const ALPHA_THRESHOLD = 40;
const LIGHT_BLOOM_THRESHOLD = 540;
const NIGHT_BUILDING_BASE: [number, number, number] = [34, 34, 46];
const NIGHT_LIT_THRESHOLD = 400;
const NIGHT_WARM_COLOR: [number, number, number] = [255, 200, 110];
const DAY_SATURATION_BOOST = 1.25;
// Per-cell fade after its reveal delay hits — cells ease in instead of popping.
const CELL_FADE_MS = 450;
// Twinkle: brightness wobble amplitude on lit windows (fraction of the color).
const TWINKLE_AMP = 0.5;

type RGB = [number, number, number];

const BAYER: Record<DitherGrid, number[][]> = {
  "2x2": [
    [0, 2],
    [3, 1],
  ].map((row) => row.map((v) => v / 4)),
  "4x4": [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ].map((row) => row.map((v) => v / 16)),
  "8x8": [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ].map((row) => row.map((v) => v / 64)),
};

function clampByte(c: number) {
  return Math.max(0, Math.min(255, Math.round(c)));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function rgbCss([r, g, b]: RGB) {
  return `rgb(${r},${g},${b})`;
}

function lerpRgb(from: RGB, to: RGB, t: number): RGB {
  return [
    (from[0] + (to[0] - from[0]) * t) | 0,
    (from[1] + (to[1] - from[1]) * t) | 0,
    (from[2] + (to[2] - from[2]) * t) | 0,
  ];
}

function boostSaturation([r, g, b]: RGB, factor: number): RGB {
  const avg = (r + g + b) / 3;
  return [
    clampByte(avg + (r - avg) * factor),
    clampByte(avg + (g - avg) * factor),
    clampByte(avg + (b - avg) * factor),
  ];
}

// Night color for a scene that has no dedicated night image: dark building
// base, warmed toward window-light on the brighter parts of the day pixel.
function deriveNightColor([r, g, b]: RGB): RGB {
  const lum = (r + g + b) / 3;
  const lit = Math.max(0, Math.min(1, (lum - 90) / 120));
  return [
    Math.round(NIGHT_BUILDING_BASE[0] + (NIGHT_WARM_COLOR[0] - NIGHT_BUILDING_BASE[0]) * lit),
    Math.round(NIGHT_BUILDING_BASE[1] + (NIGHT_WARM_COLOR[1] - NIGHT_BUILDING_BASE[1]) * lit),
    Math.round(NIGHT_BUILDING_BASE[2] + (NIGHT_WARM_COLOR[2] - NIGHT_BUILDING_BASE[2]) * lit),
  ];
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      void img
        .decode()
        .then(() => resolve(img))
        .catch(() => resolve(img));
    img.onerror = reject;
    img.src = src;
  });
}

// --- fog ---------------------------------------------------------------
// Fog is a horizontal bank with a turbulent top edge, not a set of round
// puffs. We bake fractal value-noise density textures (tileable in x, with
// the noisy fog-line falloff baked into the alpha channel) and scroll two
// decorrelated layers at different speeds — their sum evolves like real
// turbulence instead of sliding as one rigid sheet.

const FOG_TINT: Record<ResolvedMode, RGB> = {
  day: [222, 228, 237],
  night: [148, 158, 186],
};

// [far layer, near layer] opacities. Day fog must be dense to read against a
// pale sky — it only registers where it swallows the building bases.
const FOG_LAYER_ALPHA: Record<ResolvedMode, [number, number]> = {
  day: [0.62, 0.54],
  night: [0.44, 0.38],
};

const FOG_TEX_W = 1024;
const FOG_TEX_H = 256;

/** Deterministic PRNG so the two fog layers are stable but decorrelated. */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

type Cell = {
  x: number;
  y: number;
  col: number;
  row: number;
  day: RGB;
  night: RGB;
  dayCss: string;
  nightCss: string;
  /** color this cell crossfades from on a mode change; null on first reveal */
  from: RGB | null;
  /** night lit-window brightness 0..1, drives twinkle + bloom */
  litBase: number;
  isLit: boolean;
  twinklePhase: number;
  twinkleSpeed: number;
  delay: number;
};

export class SkylineEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: EngineOptions;

  private cells: Cell[] = [];
  private dayImg: HTMLImageElement | null = null;
  private nightImg: HTMLImageElement | null = null;
  private cellSizePx = 4;
  private drawWidth = 0;
  private drawHeight = 0;
  private offsetX = 0;
  private offsetY = 0;
  private cssWidth = 0;
  private cssHeight = 0;

  private raf = 0;
  private running = false;
  private paused = false;
  private pausedAt = 0;
  private cancelled = false;
  private startTime = 0;
  private settleTime = 0;

  private bloomSprites = new Map<number, HTMLCanvasElement>();
  private fogTextures = new Map<string, HTMLCanvasElement>();

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("skyline-mosaic: 2D canvas context unavailable");
    this.ctx = ctx;
    this.opts = opts;
    void this.load();
  }

  private async load() {
    const [day, night] = await Promise.all([
      loadImage(this.opts.dayImageSrc),
      this.opts.nightImageSrc
        ? loadImage(this.opts.nightImageSrc)
        : Promise.resolve(null),
    ]);
    if (this.cancelled) return;
    this.dayImg = day;
    this.nightImg = night;
    this.build();
    this.ensureRunning();
  }

  /** (Re)sample the images into the cell grid at the current canvas size. */
  private build(replayReveal = true) {
    const { canvas, ctx, opts } = this;
    if (!this.dayImg) return;
    const parent = canvas.parentElement;
    const cssWidth = parent?.clientWidth ?? canvas.clientWidth;
    const cssHeight = parent?.clientHeight ?? canvas.clientHeight;
    if (!cssWidth || !cssHeight) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;

    const size = Math.max(
      MIN_CELL_SIZE,
      opts.cellSize ?? Math.round(cssWidth * opts.cellSizeRatio)
    );
    this.cellSizePx = size;

    // Fit the image to the container width, anchored to the bottom.
    this.drawWidth = cssWidth;
    this.drawHeight = (this.dayImg.height / this.dayImg.width) * cssWidth;
    this.offsetX = 0;
    this.offsetY = cssHeight - this.drawHeight;

    const dayData = this.sample(this.dayImg);
    const nightData = this.nightImg ? this.sample(this.nightImg) : null;
    if (!dayData) return;

    const cells: Cell[] = [];
    const cols = Math.ceil(this.drawWidth / size);
    const rows = Math.ceil(this.drawHeight / size);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const px = Math.min(col * size, this.drawWidth - 1);
        const py = Math.min(row * size, this.drawHeight - 1);
        const idx = (py * this.drawWidth + px) * 4;
        if (dayData[idx + 3] <= ALPHA_THRESHOLD) continue;

        const day = boostSaturation(
          [dayData[idx], dayData[idx + 1], dayData[idx + 2]],
          DAY_SATURATION_BOOST
        );
        const { color: night, litBase, isLit } = this.nightColor(
          nightData,
          px,
          py,
          size,
          day
        );

        cells.push({
          x: this.offsetX + col * size,
          y: this.offsetY + row * size,
          col,
          row,
          day,
          night,
          dayCss: rgbCss(day),
          nightCss: rgbCss(night),
          from: null,
          litBase,
          isLit,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.9 + Math.random() * 1.6,
          delay: 0,
        });
      }
    }
    this.cells = cells;
    this.settleTime = 0;

    if (replayReveal) {
      this.assignDelays();
      this.startTime = performance.now();
    } else {
      // e.g. a resize after the intro already played — render settled
      // immediately instead of vanishing and replaying the build-in.
      this.startTime = performance.now() - this.settleTimeMs() - 1;
    }
  }

  private sample(img: HTMLImageElement): Uint8ClampedArray | null {
    const c = document.createElement("canvas");
    c.width = this.drawWidth;
    c.height = this.drawHeight;
    const cctx = c.getContext("2d", { willReadFrequently: true });
    if (!cctx) return null;
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(img, 0, 0, this.drawWidth, this.drawHeight);
    return cctx.getImageData(0, 0, this.drawWidth, this.drawHeight).data;
  }

  private nightColor(
    nightData: Uint8ClampedArray | null,
    px: number,
    py: number,
    size: number,
    day: RGB
  ): { color: RGB; litBase: number; isLit: boolean } {
    if (!nightData) {
      const color = deriveNightColor(day);
      const lum = (color[0] + color[1] + color[2]) / 3 / 255;
      return { color, litBase: lum, isLit: lum > 0.4 };
    }

    // Brightest pixel in the block so sparse lit windows aren't skipped.
    let best = -1;
    let nr = 0;
    let ng = 0;
    let nb = 0;
    const xEnd = Math.min(px + size, this.drawWidth);
    const yEnd = Math.min(py + size, this.drawHeight);
    for (let by = py; by < yEnd; by++) {
      for (let bx = px; bx < xEnd; bx++) {
        const bIdx = (by * this.drawWidth + bx) * 4;
        const brightness = nightData[bIdx] + nightData[bIdx + 1] + nightData[bIdx + 2];
        if (brightness > best) {
          best = brightness;
          nr = nightData[bIdx];
          ng = nightData[bIdx + 1];
          nb = nightData[bIdx + 2];
        }
      }
    }

    const brightness = nr + ng + nb;
    const isLit = brightness > NIGHT_LIT_THRESHOLD;
    const intensity = isLit
      ? Math.min(1, (brightness - NIGHT_LIT_THRESHOLD) / 280)
      : 0;
    const maxC = Math.max(nr, ng, nb);
    const minC = Math.min(nr, ng, nb);
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
    const isColoredAccent = isLit && saturation > 0.35;
    const boost = 1 + intensity * 0.6;

    const color: RGB = !isLit
      ? [...NIGHT_BUILDING_BASE]
      : isColoredAccent
        ? [clampByte(nr * boost), clampByte(ng * boost), clampByte(nb * boost)]
        : [
            Math.round(NIGHT_BUILDING_BASE[0] + (NIGHT_WARM_COLOR[0] - NIGHT_BUILDING_BASE[0]) * intensity),
            Math.round(NIGHT_BUILDING_BASE[1] + (NIGHT_WARM_COLOR[1] - NIGHT_BUILDING_BASE[1]) * intensity),
            Math.round(NIGHT_BUILDING_BASE[2] + (NIGHT_WARM_COLOR[2] - NIGHT_BUILDING_BASE[2]) * intensity),
          ];
    return { color, litBase: intensity, isLit };
  }

  /** Choreograph the build-in / mode-change reveal per the transition style. */
  private assignDelays() {
    const { transition, transitionDurationMs, reducedMotion } = this.opts;
    this.settleTime = 0;
    if (reducedMotion) {
      for (const c of this.cells) c.delay = 0;
      return;
    }
    const d = transitionDurationMs;
    for (const c of this.cells) {
      if (transition === "sweep") {
        const t = this.drawWidth ? (c.x - this.offsetX) / this.drawWidth : 0;
        c.delay = easeInOutQuad(t) * d * 0.82 + Math.random() * d * 0.18;
      } else if (transition === "rise") {
        // Lights climb floor by floor: bottom rows reveal first.
        const t = this.drawHeight ? (c.y - this.offsetY) / this.drawHeight : 0;
        c.delay = easeInOutQuad(1 - t) * d * 0.82 + Math.random() * d * 0.18;
      } else {
        // Bias delays early so the reveal starts dense and settles gently —
        // an ease-out feel for a stochastic dissolve.
        c.delay = Math.pow(Math.random(), 1.7) * d;
      }
    }
  }

  // --- lifecycle -----------------------------------------------------------

  private continuousNeeded(now: number): boolean {
    const elapsed = now - this.startTime;
    if (elapsed < this.settleTimeMs()) return true;
    if (this.opts.effect === "shimmer") return true;
    if (this.opts.fog && !this.opts.reducedMotion) return true;
    if (
      this.opts.mode === "night" &&
      this.opts.twinkle &&
      !this.opts.reducedMotion
    )
      return true;
    return false;
  }

  private settleTimeMs() {
    if (this.settleTime) return this.settleTime;
    let max = 0;
    for (const c of this.cells) if (c.delay > max) max = c.delay;
    this.settleTime = max + CELL_FADE_MS + 60;
    return this.settleTime;
  }

  private ensureRunning() {
    if (this.running || this.paused || this.cancelled) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (this.cancelled || this.paused) {
      this.running = false;
      return;
    }
    this.draw(now);
    if (this.continuousNeeded(now)) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.running = false; // settled — stop burning frames until something changes
    }
  };

  // --- rendering -----------------------------------------------------------

  private draw(now: number) {
    const { ctx, opts } = this;
    const elapsed = now - this.startTime;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    if (opts.effect === "dither") this.renderDither(elapsed, now);
    else if (opts.effect === "shimmer") this.renderShimmer(elapsed, now);
    else this.renderMosaic(elapsed, now);

    if (opts.mode === "night") this.renderBloom(elapsed, now);
    if (opts.fog) this.renderFog(elapsed, now);
  }

  // --- fog -----------------------------------------------------------------

  /**
   * Bake a fog-bank density texture: fractal value noise (tileable in x)
   * with a noisy fog-line falloff baked into alpha — dense continuous base,
   * irregular wisps clawing up at the top edge.
   */
  private fogTexture(mode: ResolvedMode, seed: number): HTMLCanvasElement {
    const key = `${mode}-${seed}`;
    const cached = this.fogTextures.get(key);
    if (cached) return cached;

    const W = FOG_TEX_W;
    const H = FOG_TEX_H;
    const rand = mulberry32(seed);
    // 4 octaves of lattice noise; cols divide evenly so x wraps seamlessly.
    const octaves = [
      { cols: 5, rows: 3, amp: 0.5 },
      { cols: 10, rows: 6, amp: 0.26 },
      { cols: 20, rows: 12, amp: 0.16 },
      { cols: 40, rows: 24, amp: 0.08 },
    ].map((o) => ({
      ...o,
      grid: Array.from({ length: o.rows + 1 }, () =>
        Array.from({ length: o.cols }, () => rand())
      ),
    }));

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const cctx = canvas.getContext("2d")!;
    const img = cctx.createImageData(W, H);
    const [r, g, b] = FOG_TINT[mode];

    for (let y = 0; y < H; y++) {
      const h01 = y / (H - 1); // 0 = top of bank, 1 = base
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (const o of octaves) {
          const gx = (x / W) * o.cols;
          const gy = (y / H) * o.rows;
          const i0 = Math.floor(gx);
          const j0 = Math.min(o.rows - 1, Math.floor(gy));
          const fx = smooth(gx - i0);
          const fy = smooth(gy - j0);
          const i1 = (i0 + 1) % o.cols;
          const row0 = o.grid[j0];
          const row1 = o.grid[j0 + 1];
          n +=
            o.amp *
            ((row0[i0 % o.cols] * (1 - fx) + row0[i1] * fx) * (1 - fy) +
              (row1[i0 % o.cols] * (1 - fx) + row1[i1] * fx) * fy);
        }
        // Noisy fog line: the noise perturbs where the bank tops out, so the
        // edge is turbulent instead of a clean gradient.
        let a = smoothstep(0.18, 0.78, h01 + (n - 0.5) * 0.75);
        a *= 0.55 + 0.45 * n; // interior texture — not a flat wash
        const idx = (y * W + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = Math.round(a * 255);
      }
    }
    cctx.putImageData(img, 0, 0);
    this.fogTextures.set(key, canvas);
    return canvas;
  }

  private renderFog(elapsed: number, now: number) {
    const { ctx, opts } = this;
    // Fog fades in with the scene build so it doesn't pop over an empty sky.
    const reveal = opts.reducedMotion
      ? 1
      : Math.min(1, Math.max(0, elapsed / this.settleTimeMs()));
    const t = opts.reducedMotion ? 0 : now * 0.001;
    const [alphaFar, alphaNear] = FOG_LAYER_ALPHA[opts.mode];
    const bandH = Math.min(this.cssHeight, this.drawHeight * 0.62);

    // Two decorrelated layers at different speeds/heights — their sum evolves
    // over time like turbulence, instead of one rigid sheet translating.
    const layers = [
      { seed: 1337, h: bandH, speed: 7, alpha: alphaFar, bob: 0, phase: 0.9 },
      { seed: 9241, h: bandH * 0.74, speed: 16, alpha: alphaNear, bob: 5, phase: 2.6 },
    ];

    ctx.save();
    for (const L of layers) {
      const tex = this.fogTexture(opts.mode, L.seed);
      // Stretch horizontally ~2.2x — fog streaks sideways, not round.
      const tileW = (FOG_TEX_W / FOG_TEX_H) * L.h * 2.2;
      const y =
        this.cssHeight - L.h + Math.sin(t * 0.18 + L.phase) * L.bob;
      const pulse = 0.86 + 0.14 * Math.sin(t * 0.1 + L.phase * 2);
      ctx.globalAlpha = Math.min(1, L.alpha * pulse * reveal);
      const off = (t * L.speed) % tileW;
      for (let x = -off; x < this.cssWidth; x += tileW) {
        ctx.drawImage(tex, x, y, tileW, L.h);
      }
    }
    ctx.restore();
  }

  /**
   * Twinkle waveform for a lit cell, -1..1. Two detuned sines so windows
   * sparkle irregularly instead of breathing in sync.
   */
  private twinkleWave(c: Cell, now: number) {
    const a = now * 0.001 * c.twinkleSpeed + c.twinklePhase;
    return Math.sin(a) * 0.6 + Math.sin(a * 2.33 + c.twinklePhase * 1.7) * 0.4;
  }

  /**
   * Reveal progress for a cell: 0 before its delay, eased 0→1 across
   * CELL_FADE_MS after it. Cells fade in / crossfade instead of popping.
   */
  private revealProgress(c: Cell, elapsed: number) {
    if (this.opts.reducedMotion) return 1;
    const t = (elapsed - c.delay) / CELL_FADE_MS;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return easeOutCubic(t);
  }

  /** Static target color for the current mode, before twinkle/glow dynamics. */
  private baseColor(c: Cell): RGB {
    return this.opts.mode === "night" ? c.night : c.day;
  }

  private nightDynamics(c: Cell, now: number): RGB | null {
    // Ambient twinkle: brightness sparkle on lit windows.
    if (!this.opts.twinkle || !c.isLit || this.opts.reducedMotion) return null;
    const t = 1 + TWINKLE_AMP * this.twinkleWave(c, now) * Math.max(0.35, c.litBase);
    return [
      clampByte(c.night[0] * t),
      clampByte(c.night[1] * t),
      clampByte(c.night[2] * t),
    ];
  }

  private renderMosaic(elapsed: number, now: number) {
    const { ctx } = this;
    const size = Math.max(1, this.cellSizePx - this.opts.cellGap);
    const isNight = this.opts.mode === "night";

    for (const c of this.cells) {
      const p = this.revealProgress(c, elapsed);

      if (p <= 0) {
        // Not this cell's turn yet: on a mode change keep showing the old
        // color instead of blanking the skyline.
        if (!c.from) continue;
        ctx.fillStyle = rgbCss(c.from);
        ctx.fillRect(c.x, c.y, size, size);
        continue;
      }

      if (p >= 1) {
        // Settled: cached strings unless twinkle/glow are animating this cell.
        const dynamic = isNight ? this.nightDynamics(c, now) : null;
        ctx.fillStyle = dynamic
          ? rgbCss(dynamic)
          : isNight
            ? c.nightCss
            : c.dayCss;
        ctx.fillRect(c.x, c.y, size, size);
        continue;
      }

      // Mid-fade: crossfade from the previous color, or fade up from nothing.
      const target = this.baseColor(c);
      if (c.from) {
        ctx.fillStyle = rgbCss(lerpRgb(c.from, target, p));
        ctx.fillRect(c.x, c.y, size, size);
      } else {
        ctx.globalAlpha = p;
        ctx.fillStyle = isNight ? c.nightCss : c.dayCss;
        ctx.fillRect(c.x, c.y, size, size);
        ctx.globalAlpha = 1;
      }
    }
  }

  private renderDither(elapsed: number, now: number) {
    const { ctx, opts } = this;
    const bayer = BAYER[opts.dither.grid];
    const bs = bayer.length;
    const levels = Math.max(2, opts.dither.levels);
    const isNight = opts.mode === "night";
    const step = 255 / (levels - 1);

    for (const c of this.cells) {
      const p = this.revealProgress(c, elapsed);
      if (p <= 0 && !c.from) continue;

      const dynamic = isNight && p >= 1 ? this.nightDynamics(c, now) : null;
      let color = dynamic ?? this.baseColor(c);
      if (p < 1 && c.from) color = lerpRgb(c.from, color, p);

      const threshold = bayer[((c.row % bs) + bs) % bs][((c.col % bs) + bs) % bs];
      const q = (v: number) => {
        const lower = Math.floor(v / step) * step;
        const frac = (v - lower) / step;
        return frac > threshold ? Math.min(255, lower + step) : lower;
      };
      if (p < 1 && !c.from) ctx.globalAlpha = p;
      ctx.fillStyle = `rgb(${q(color[0])},${q(color[1])},${q(color[2])})`;
      this.ditherShape(c.x, c.y);
      if (p < 1 && !c.from) ctx.globalAlpha = 1;
    }
  }

  private ditherShape(x: number, y: number) {
    const { ctx } = this;
    const outer = Math.max(1, this.cellSizePx - this.opts.cellGap);
    const cx = x + outer / 2;
    const cy = y + outer / 2;
    ctx.beginPath();
    switch (this.opts.dither.shape) {
      case "circle":
        ctx.arc(cx, cy, outer / 2, 0, Math.PI * 2);
        break;
      case "diamond":
        ctx.moveTo(cx, y);
        ctx.lineTo(x + outer, cy);
        ctx.lineTo(cx, y + outer);
        ctx.lineTo(x, cy);
        ctx.closePath();
        break;
      case "dot":
        ctx.arc(cx, cy, Math.max(0.5, outer * 0.42), 0, Math.PI * 2);
        break;
      default:
        ctx.rect(x, y, outer, outer);
    }
    ctx.fill();
  }

  private renderShimmer(elapsed: number, now: number) {
    const { ctx, opts } = this;
    const size = Math.max(1, this.cellSizePx - opts.cellGap);
    const sweepMs = 2600;
    const phase = (now % sweepMs) / sweepMs;
    const diagSpan = this.cssWidth + this.cssHeight;
    const isNight = opts.mode === "night";

    for (const c of this.cells) {
      const p = this.revealProgress(c, elapsed);
      if (p <= 0 && !c.from) continue;

      const diagPos = (c.x + (this.cssHeight - c.y)) / diagSpan;
      const dist = Math.abs(((diagPos - phase + 1.5) % 1) - 0.5);
      const specular = Math.max(0, 1 - dist * 6) * 160;

      let target: RGB;
      if (isNight) {
        const [nr, ng, nb] = c.night;
        const lum = (nr + ng + nb) / 3;
        const base = 30 + (lum / 255) * 110;
        const v = Math.min(255, base + specular);
        target = [v | 0, v | 0, (v + 4) | 0];
      } else {
        const [dr, dg, db] = c.day;
        const lum = (dr + dg + db) / 3 / 255;
        const shade = 0.55 + lum * 0.35;
        target = [
          Math.min(255, dr * shade + specular) | 0,
          Math.min(255, dg * shade + specular) | 0,
          Math.min(255, db * shade + specular * 0.92) | 0,
        ];
      }

      if (p < 1 && c.from) target = lerpRgb(c.from, target, p);
      if (p < 1 && !c.from) ctx.globalAlpha = p;
      ctx.fillStyle = rgbCss(target);
      ctx.fillRect(c.x, c.y, size, size);
      if (p < 1 && !c.from) ctx.globalAlpha = 1;
    }
  }

  /**
   * Soft halo around lit windows. Uses pre-rendered radial-gradient sprites
   * composited additively — `ctx.shadowBlur` per cell is orders of magnitude
   * slower and was the main source of night-mode jank.
   */
  private renderBloom(elapsed: number, now: number) {
    const { ctx } = this;
    // Keep halos tight and faint — additive sprites stack up fast, and too
    // much bloom melts the crisp window grid into bokeh mush.
    const radius = this.cellSizePx * 2.5;
    const twinkling = this.opts.twinkle && !this.opts.reducedMotion;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const c of this.cells) {
      if (c.night[0] + c.night[1] + c.night[2] <= LIGHT_BLOOM_THRESHOLD) continue;
      const p = this.revealProgress(c, elapsed);
      if (p <= 0) continue;
      let strength = 0.28 + 0.34 * c.litBase;
      // Halos breathe with the same waveform as the window color, so a
      // sparkle reads as light, not just a color change.
      if (twinkling) strength *= 1 + 0.5 * this.twinkleWave(c, now);
      ctx.globalAlpha = p * Math.max(0, Math.min(1, strength));
      ctx.drawImage(
        this.bloomSprite(c.night),
        c.x - radius,
        c.y - radius,
        radius * 2,
        radius * 2
      );
    }
    ctx.restore();
  }

  private bloomSprite([r, g, b]: RGB): HTMLCanvasElement {
    // Bucket to 16 levels per channel so a handful of sprites cover the scene.
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cached = this.bloomSprites.get(key);
    if (cached) return cached;
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const cctx = c.getContext("2d")!;
    const grad = cctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},0.18)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, size, size);
    this.bloomSprites.set(key, c);
    return c;
  }

  // --- public API driven by the framework wrapper -------------------------

  /**
   * Switch day/night. Cells crossfade from their current palette to the new
   * one in choreographed order — the skyline never blanks.
   */
  setMode(mode: ResolvedMode) {
    if (mode === this.opts.mode) return;
    const prevBase: RGB[] = this.cells.map((c) =>
      this.opts.mode === "night" ? c.night : c.day
    );
    this.opts.mode = mode;
    this.cells.forEach((c, i) => {
      c.from = prevBase[i];
    });
    this.assignDelays();
    this.startTime = performance.now();
    this.ensureRunning();
  }

  /** Merge option changes; rebuilds the grid only when geometry changed. */
  setOptions(next: Partial<EngineOptions>) {
    const prev = this.opts;
    this.opts = { ...prev, ...next };

    // Changing the source images means re-loading and re-sampling.
    if (
      (next.dayImageSrc !== undefined && next.dayImageSrc !== prev.dayImageSrc) ||
      (next.nightImageSrc !== undefined && next.nightImageSrc !== prev.nightImageSrc)
    ) {
      void this.load();
      return;
    }

    // Cell geometry changed — re-sample the grid.
    const geometryChanged =
      (next.cellSize !== undefined && next.cellSize !== prev.cellSize) ||
      (next.cellSizeRatio !== undefined && next.cellSizeRatio !== prev.cellSizeRatio);
    if (geometryChanged) {
      this.build();
      this.ensureRunning();
      return;
    }

    // Transition style changed — nothing to replay; it applies to the next
    // reveal. Everything else (effect, dither, cellGap, twinkle, radius, …)
    // is applied at render time — just make sure a frame runs.
    this.ensureRunning();
  }

  /** Re-run the reveal animation without re-sampling (e.g. a demo replay). */
  replay() {
    for (const c of this.cells) c.from = null;
    this.assignDelays();
    this.startTime = performance.now();
    this.ensureRunning();
  }

  resize() {
    if (!this.dayImg) return;
    // Replay the intro only if it hadn't finished; otherwise render settled —
    // resizing a window shouldn't blank the skyline and replay 2s of build-in.
    const midReveal =
      performance.now() - this.startTime < this.settleTimeMs();
    this.build(midReveal);
    this.ensureRunning();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    // Shift the clock so a paused reveal resumes where it left off.
    this.startTime += performance.now() - this.pausedAt;
    this.ensureRunning();
  }

  destroy() {
    this.cancelled = true;
    cancelAnimationFrame(this.raf);
  }
}
