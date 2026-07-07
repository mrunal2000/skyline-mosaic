// Framework-free rendering engine for the skyline mosaic. Owns the canvas,
// the cell grid, every effect, and the render-loop lifecycle. The React
// component (and future Vue/Svelte wrappers) are thin drivers over this.

export type ResolvedMode = "day" | "night";
export type Effect = "mosaic" | "dither" | "halftone";
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
  clouds: boolean;
  reducedMotion: boolean;
};

const MIN_CELL_SIZE = 2;
const ALPHA_THRESHOLD = 40;
const LIGHT_BLOOM_THRESHOLD = 540;
const NIGHT_BUILDING_BASE: [number, number, number] = [34, 34, 46];
const NIGHT_LIT_THRESHOLD = 400;
const NIGHT_WARM_COLOR: [number, number, number] = [255, 200, 110];
const DAY_SATURATION_BOOST = 1.15;
// Art-directed day grade: shadows pulled toward slate-teal, highlights toward
// warm paper — a palette that reads as designed rather than filtered.
const DAY_SHADOW_TINT: RGB = [92, 112, 124];
const DAY_HIGHLIGHT_TINT: RGB = [252, 242, 222];
const DAY_GRADE_MIX = 0.38;
// Buildings split where the rooftop line jumps by more than this many cells.
const BUILDING_SPLIT = 4;
// Red aviation beacons on the tallest towers (night + twinkle).
const BEACON_COLOR: RGB = [255, 64, 72];
const MAX_BEACONS = 4;
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

/**
 * Day grade: split-tone the photo pixel by luminance (cool shadows, warm
 * highlights), then a gentle saturation lift — the palette feels chosen,
 * not sampled.
 */
function gradeDay(rgb: RGB): RGB {
  const lum = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
  const t = lum * lum * (3 - 2 * lum);
  const tint = lerpRgb(DAY_SHADOW_TINT, DAY_HIGHLIGHT_TINT, t);
  return boostSaturation(lerpRgb(rgb, tint, DAY_GRADE_MIX), DAY_SATURATION_BOOST);
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
  /** which building (column-profile segment) this cell belongs to */
  b: number;
  /** discrete window state; onAmount eases 0..1 toward isOn */
  isOn: boolean;
  onAmount: number;
  nextFlipAt: number;
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
  private buildings: { top: number; bottom: number; startCol: number; endCol: number }[] = [];
  private beacons: { x: number; y: number; phase: number }[] = [];
  private cloudTextures = new Map<number, HTMLCanvasElement>();
  private pointer: { x: number; y: number } | null = null;
  /** eased 0..1 strength + smoothed position of the cursor's cloud-clearing */
  private part = { x: 0, y: 0, amount: 0 };
  private onPointerMove?: (e: PointerEvent) => void;
  private onPointerLeave?: () => void;

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("skyline-mosaic: 2D canvas context unavailable");
    this.ctx = ctx;
    this.opts = opts;
    void this.load();
    if (opts.clouds) this.attachPointer();
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

        const day = gradeDay([dayData[idx], dayData[idx + 1], dayData[idx + 2]]);
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
          b: 0,
          isOn: true,
          onAmount: 1,
          nextFlipAt: 0,
          delay: 0,
        });
      }
    }
    this.cells = cells;
    this.settleTime = 0;
    this.segmentBuildings();

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

  /**
   * Split the skyline into buildings using the column height profile: a new
   * building starts wherever the rooftop line jumps. This lets the reveal and
   * the beacons treat the city as buildings instead of pixels.
   */
  private segmentBuildings() {
    const colTop = new Map<number, number>();
    const colBottom = new Map<number, number>();
    let maxCol = 0;
    for (const c of this.cells) {
      maxCol = Math.max(maxCol, c.col);
      const t = colTop.get(c.col);
      if (t === undefined || c.row < t) colTop.set(c.col, c.row);
      const bo = colBottom.get(c.col);
      if (bo === undefined || c.row > bo) colBottom.set(c.col, c.row);
    }

    const colBuilding = new Array<number>(maxCol + 1).fill(-1);
    const buildings: { top: number; bottom: number; startCol: number; endCol: number }[] = [];
    let prevTop: number | null = null;
    for (let col = 0; col <= maxCol; col++) {
      const top = colTop.get(col);
      if (top === undefined) {
        prevTop = null;
        continue;
      }
      if (prevTop === null || Math.abs(top - prevTop) > BUILDING_SPLIT) {
        buildings.push({
          top,
          bottom: colBottom.get(col) ?? top,
          startCol: col,
          endCol: col,
        });
      } else {
        const b = buildings[buildings.length - 1];
        b.top = Math.min(b.top, top);
        b.bottom = Math.max(b.bottom, colBottom.get(col) ?? top);
        b.endCol = col;
      }
      colBuilding[col] = buildings.length - 1;
      prevTop = top;
    }
    for (const c of this.cells) c.b = Math.max(0, colBuilding[c.col]);
    this.buildings = buildings;

    // Aviation beacons on the tallest towers (smallest top row).
    const size = this.cellSizePx;
    this.beacons = buildings
      .filter((b) => b.bottom - b.top > 8 && b.endCol - b.startCol >= 2)
      .sort((a, z) => a.top - z.top)
      .slice(0, MAX_BEACONS)
      .map((b) => ({
        x: this.offsetX + ((b.startCol + b.endCol) / 2) * size + size / 2,
        y: this.offsetY + b.top * size - size * 0.8,
        phase: Math.random() * Math.PI * 2,
      }));
  }

  /** Choreograph the reveal: per-transition timing on each cell. */
  private assignDelays() {
    const { transition, transitionDurationMs, reducedMotion } = this.opts;
    this.settleTime = 0;
    if (reducedMotion) {
      for (const c of this.cells) c.delay = 0;
      return;
    }
    const d = transitionDurationMs;

    if (transition === "dissolve") {
      // Random scatter: each cell pops on independently, like static resolving.
      const spread = Math.max(1, d - 60);
      for (const c of this.cells) c.delay = Math.random() * spread;
      return;
    }

    const n = Math.max(1, this.buildings.length);

    // Order the buildings by transition style, then stagger their starts.
    const order = this.buildings.map((_, i) => i);
    if (transition === "sweep") {
      order.sort((a, z) => this.buildings[a].startCol - this.buildings[z].startCol);
    } else if (transition === "rise") {
      // Shortest first — the towers complete the skyline.
      order.sort((a, z) => this.buildings[z].top - this.buildings[a].top);
    }
    const startOf = new Array<number>(n).fill(0);
    order.forEach((b, pos) => {
      startOf[b] = (pos / n) * d * 0.72 + Math.random() * d * 0.06;
    });

    // Within a building, windows come on bottom-up with a little jitter —
    // floors lighting one after another.
    for (const c of this.cells) {
      const b = this.buildings[c.b];
      if (!b) {
        c.delay = Math.random() * d;
        continue;
      }
      const h = Math.max(1, b.bottom - b.top);
      const fromBottom = (b.bottom - c.row) / h; // 0 at base, 1 at rooftop
      c.delay = startOf[c.b] + fromBottom * d * 0.22 + Math.random() * d * 0.06;
    }
  }

  // --- clouds ----------------------------------------------------------------

  /**
   * Cloud density texture: same fractal machinery as the fog, but thresholded
   * into patchy streaks and shaped by a gaussian band so clouds live in the
   * mid-sky rather than forming a solid sheet.
   */
  private cloudTexture(seed: number): HTMLCanvasElement {
    const cached = this.cloudTextures.get(seed);
    if (cached) return cached;
    const W = FOG_TEX_W;
    const H = FOG_TEX_H;
    const rand = mulberry32(seed);
    const octaves = [
      { cols: 4, rows: 2, amp: 0.5 },
      { cols: 8, rows: 4, amp: 0.27 },
      { cols: 16, rows: 8, amp: 0.15 },
      { cols: 32, rows: 16, amp: 0.08 },
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
    for (let y = 0; y < H; y++) {
      const h01 = y / (H - 1);
      const band = Math.exp(-Math.pow((h01 - 0.42) / 0.44, 2));
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
        // Threshold the noise so clouds are patchy streaks, not a wash;
        // edge fades guarantee the drawn rect never shows a hard cut line.
        const edge = smoothstep(0, 0.18, h01) * (1 - smoothstep(0.8, 1, h01));
        const a = band * edge * smoothstep(0.32, 0.68, n);
        const idx = (y * W + x) * 4;
        img.data[idx] = 255;
        img.data[idx + 1] = 255;
        img.data[idx + 2] = 255;
        img.data[idx + 3] = Math.round(a * 255);
      }
    }
    cctx.putImageData(img, 0, 0);
    this.cloudTextures.set(seed, canvas);
    return canvas;
  }

  private renderClouds(elapsed: number, now: number) {
    const { ctx, opts } = this;
    const reveal = opts.reducedMotion
      ? 1
      : Math.min(1, Math.max(0, elapsed / this.settleTimeMs()));
    const t = opts.reducedMotion ? 0 : now * 0.001;

    // Two decorrelated layers in the upper sky, drifting with the wind.
    // Day: bright white streaks. Night: the same clouds as faint moonlit
    // shapes — barely-there gray against the dark sky.
    const night = opts.mode === "night";
    const layers = [
      { seed: 4242, top: 0.02, h: 0.6, speed: 3.5, alpha: night ? 0.24 : 0.85, phase: 0.4 },
      { seed: 8181, top: 0.08, h: 0.52, speed: 8, alpha: night ? 0.17 : 0.65, phase: 1.7 },
    ];

    ctx.save();
    for (const L of layers) {
      const tex = this.cloudTexture(L.seed);
      const h = this.cssHeight * L.h;
      const tileW = (FOG_TEX_W / FOG_TEX_H) * h * 2.6;
      const wind = t + Math.sin(t * 0.05 + L.phase) * 9;
      const off = (((wind * L.speed) % tileW) + tileW) % tileW;
      ctx.globalAlpha = L.alpha * reveal;
      for (let x = -off; x < this.cssWidth; x += tileW) {
        ctx.drawImage(tex, x, this.cssHeight * L.top, tileW, h);
      }
    }

    // Cursor parts the clouds: a soft clearing eases open under the pointer
    // and drifts closed again when it leaves.
    const target = this.pointer ? 1 : 0;
    this.part.amount += (target - this.part.amount) * 0.07;
    if (this.pointer) {
      const k = this.part.amount < 0.05 ? 1 : 0.12;
      this.part.x += (this.pointer.x - this.part.x) * k;
      this.part.y += (this.pointer.y - this.part.y) * k;
    }
    if (this.part.amount > 0.01) {
      const r = Math.max(90, Math.min(190, this.cssWidth * 0.11));
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = this.part.amount * 0.9;
      ctx.drawImage(
        this.bloomSprite([255, 255, 255]),
        this.part.x - r,
        this.part.y - r,
        r * 2,
        r * 2
      );
    }
    ctx.restore();
  }

  private attachPointer() {
    if (this.onPointerMove) return;
    this.onPointerMove = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.pointer =
        x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
          ? { x, y }
          : null;
      this.ensureRunning();
    };
    this.onPointerLeave = () => {
      this.pointer = null;
      this.ensureRunning();
    };
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("blur", this.onPointerLeave);
  }

  private detachPointer() {
    if (this.onPointerMove)
      window.removeEventListener("pointermove", this.onPointerMove);
    if (this.onPointerLeave) {
      window.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
    }
    this.onPointerMove = undefined;
    this.onPointerLeave = undefined;
    this.pointer = null;
  }

  // --- lifecycle -----------------------------------------------------------

  private continuousNeeded(now: number): boolean {
    const elapsed = now - this.startTime;
    if (elapsed < this.settleTimeMs()) return true;
    // (halftone settles like mosaic — no forced continuous frame)
    if (this.opts.fog && !this.opts.reducedMotion) return true;
    if (this.opts.clouds && !this.opts.reducedMotion) return true;
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
    const fade = this.opts.transition === "dissolve" ? 0 : CELL_FADE_MS;
    this.settleTime = max + fade + 60;
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

    // Clouds sit behind the buildings — drawn first so cells occlude them.
    if (opts.clouds) this.renderClouds(elapsed, now);

    if (opts.effect === "dither") this.renderDither(elapsed, now);
    else if (opts.effect === "halftone") this.renderHalftone(elapsed, now);
    else this.renderMosaic(elapsed, now);

    if (opts.mode === "night") this.renderBloom(elapsed, now);
    if (opts.fog) this.renderFog(elapsed, now);
    if (opts.mode === "night") {
      // Light scatters through fog: re-lay a faint bloom over the bank so
      // the fog glows where the city is bright.
      if (opts.fog) this.renderBloom(elapsed, now, 0.3);
      if (opts.twinkle) this.renderBeacons(now);
    }
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
      // Wind: drift breathes in slow gusts instead of a constant crawl.
      const wind = t + Math.sin(t * 0.07 + L.phase) * 7;
      const off = (((wind * L.speed) % tileW) + tileW) % tileW;
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
   * Reveal progress for a cell: 0 before its delay, then on. Sweep/rise ease
   * in over CELL_FADE_MS; dissolve pops each cell instantly at its random slot.
   */
  private revealProgress(c: Cell, elapsed: number) {
    if (this.opts.reducedMotion) return 1;
    if (this.opts.transition === "dissolve") {
      return elapsed >= c.delay ? 1 : 0;
    }
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
    if (!this.opts.twinkle || !c.isLit || this.opts.reducedMotion) return null;

    // Discrete window behavior: someone flips a switch. A window holds its
    // state for seconds, then toggles; the change eases over a few hundred
    // ms so it reads as a light, not a glitch.
    if (c.nextFlipAt === 0) {
      c.nextFlipAt = now + 2000 + Math.random() * 20000;
    } else if (now >= c.nextFlipAt) {
      if (c.isOn && Math.random() < 0.4) {
        c.isOn = false;
        c.nextFlipAt = now + 1500 + Math.random() * 5000; // dark for a moment
      } else {
        c.isOn = true;
        c.nextFlipAt = now + 6000 + Math.random() * 22000;
      }
    }
    c.onAmount += ((c.isOn ? 1 : 0) - c.onAmount) * 0.06;

    // A faint residual flicker keeps lit glass from looking frozen.
    const flicker = 1 + 0.08 * this.twinkleWave(c, now) * c.litBase;
    const k = (0.25 + 0.75 * c.onAmount) * flicker;
    return [
      clampByte(NIGHT_BUILDING_BASE[0] + (c.night[0] - NIGHT_BUILDING_BASE[0]) * k),
      clampByte(NIGHT_BUILDING_BASE[1] + (c.night[1] - NIGHT_BUILDING_BASE[1]) * k),
      clampByte(NIGHT_BUILDING_BASE[2] + (c.night[2] - NIGHT_BUILDING_BASE[2]) * k),
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

  /**
   * Halftone print look: each cell becomes a dot sized by its ink coverage.
   * On the light day sky, darker cells make bigger dots (ink-on-paper model);
   * at night, brighter cells make bigger dots (light-on-dark). Dots grow in
   * with the reveal and, at night, pulse with twinkle.
   */
  private renderHalftone(elapsed: number, now: number) {
    const { ctx } = this;
    const spacing = this.cellSizePx;
    const half = spacing / 2;
    // >0.5 so full-coverage dots overlap into solid mass in dense areas.
    const maxR = spacing * 0.72;
    const isNight = this.opts.mode === "night";

    for (const c of this.cells) {
      const p = this.revealProgress(c, elapsed);
      if (p <= 0) continue;

      const color = isNight ? this.nightDynamics(c, now) ?? c.night : c.day;
      const lum = (color[0] + color[1] + color[2]) / 3 / 255;
      // Ink coverage: distance from the sky tone the mosaic sits on.
      const coverage = Math.max(0, Math.min(1, isNight ? lum : 1 - lum));
      const radius = maxR * Math.sqrt(coverage) * p;
      if (radius < 0.35) continue;

      ctx.fillStyle = rgbCss(color);
      ctx.beginPath();
      ctx.arc(c.x + half, c.y + half, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }


  /**
   * Soft halo around lit windows. Uses pre-rendered radial-gradient sprites
   * composited additively — `ctx.shadowBlur` per cell is orders of magnitude
   * slower and was the main source of night-mode jank.
   */
  private renderBloom(elapsed: number, now: number, alphaMul = 1) {
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
      // Halos follow the window's actual on/off state, plus a faint breath.
      if (twinkling) {
        strength *=
          (0.15 + 0.85 * c.onAmount) * (1 + 0.18 * this.twinkleWave(c, now));
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, p * strength * alphaMul));
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

  /** Blinking red aviation beacons on the tallest rooftops. */
  private renderBeacons(now: number) {
    if (!this.beacons.length) return;
    const { ctx } = this;
    const size = this.cellSizePx;
    const radius = size * 3;
    const t = now * 0.001;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const bc of this.beacons) {
      const flash = this.opts.reducedMotion
        ? 0.55
        : Math.pow(Math.max(0, Math.sin(t * 4.2 + bc.phase)), 4);
      if (flash < 0.02) continue;
      ctx.globalAlpha = flash;
      ctx.drawImage(
        this.bloomSprite(BEACON_COLOR),
        bc.x - radius,
        bc.y - radius,
        radius * 2,
        radius * 2
      );
      ctx.globalAlpha = Math.min(1, flash * 1.4);
      ctx.fillStyle = rgbCss(BEACON_COLOR);
      ctx.fillRect(
        bc.x - size / 2,
        bc.y - size / 2,
        Math.max(2, size - 1),
        Math.max(2, size - 1)
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

    if (next.clouds !== undefined && next.clouds !== prev.clouds) {
      if (next.clouds) this.attachPointer();
      else this.detachPointer();
    }

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
    this.detachPointer();
  }
}
