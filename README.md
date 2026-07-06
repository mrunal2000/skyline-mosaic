# skyline-mosaic

An animated pixel-mosaic city skyline backdrop for React. The skyline builds
itself in cell by cell, with separate day and night palettes — at night, lit
windows bloom, switch on and off, and beacons blink like the real thing.

- **Zero images to copy.** Scenes ship inlined as WebP data URIs, so it works in
  any React setup (Next.js, Vite, CRA) with nothing to drop into `public/`.
- **~113KB of scene data total** — the whole package is smaller than a single
  unoptimized hero image.
- **Idle-friendly.** The render loop stops once the scene settles, and pauses
  itself when scrolled offscreen or in a background tab. Respects
  `prefers-reduced-motion`.

## Install

```bash
npm install skyline-mosaic
```

## Usage

```tsx
"use client"; // Next.js app router only

import { SkylineMosaic } from "skyline-mosaic";

export default function Hero() {
  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <SkylineMosaic mode="auto" twinkle />
      {/* your content on top */}
      <main style={{ position: "relative", zIndex: 1 }}>…</main>
    </div>
  );
}
```

`SkylineMosaic` fills its container and renders as a `pointer-events: none`
backdrop, so give the wrapper a height and put your content on top with
`position: relative; z-index: 1`.

## Recipes

```tsx
// Follows the OS light/dark setting, with ambient window twinkle.
<SkylineMosaic mode="auto" twinkle />

// Retro ordered-dithering look with dot cells and a pixel-grid gap.
<SkylineMosaic mode="night" effect="dither" dither={{ shape: "dot" }} cellGap={1} />

// Lights rising floor by floor through drifting fog.
<SkylineMosaic mode="night" transition="rise" twinkle fog />

// Drop a paper-shaders sky (or any element) behind the skyline.
<SkylineMosaic mode="night" sky={<MeshGradient colors={[...]} />} />
```

## Props

### `SkylineMosaic`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"day" \| "night" \| "auto"` | `"day"` | Palette. `"auto"` follows `prefers-color-scheme`. |
| `scene` | `"sf"` \| `{ day, night? }` | `"sf"` | Built-in scene or a custom image pair. |
| `effect` | `"mosaic" \| "dither" \| "halftone"` | `"mosaic"` | Rendering style. |
| `dither` | `{ grid?, shape?, levels? }` | `4x4`, `square`, `4` | Ordered-dither options (used when `effect="dither"`). |
| `transition` | `"dissolve" \| "sweep" \| "rise"` | `"dissolve"` | How the reveal is choreographed. |
| `transitionDurationMs` | `number` | `2000` | Length of the build-in / mode-change reveal. |
| `twinkle` | `boolean` | `false` | Windows switch on/off like a real city; red beacons blink on the tallest towers. |
| `fog` | `boolean` | `false` | Volumetric fog bank drifting through the skyline (day and night). |
| `clouds` | `boolean` | `false` | Drifting clouds in the day sky; the cursor gently parts them. |
| `sky` | `ReactNode` | — | Content rendered behind the mosaic (e.g. a gradient/shader sky). |
| `cellSize` | `number` | — | Fixed square size in px. Overrides `cellSizeRatio`. |
| `cellSizeRatio` | `number` | `~0.0025` | Square size as a fraction of container width (~4px @ 1600px). |
| `cellGap` | `number` | `1` | Gap between squares in px — the mosaic-grid texture. `0` for solid pixels. |
| `glowHeightRatio` | `number` | `0.9` | Height of the night glow gradient (0–1 of container). |
| `pauseWhenOffscreen` | `boolean` | `true` | Pause rendering while scrolled out of view. |
| `dayImageSrc` / `nightImageSrc` | `string` | scene images | Override individual scene images. |
| `className` / `style` | — | — | Applied to the outer wrapper. |

### `ModeToggle`

An optional small day/night toggle button.

| Prop | Type | Description |
| --- | --- | --- |
| `mode` | `"day" \| "night" \| "auto"` | Current mode. |
| `onChange` | `(mode) => void` | Called with the next mode when clicked. |
| `position` | `CSSProperties` | Override the default fixed top-right placement. |

## Custom scenes

Pass any day image (transparent PNG whose alpha marks where the buildings are)
and an optional night image (sampled for lit-window colors):

```tsx
<SkylineMosaic
  scene={{ day: "/tokyo-day.png", night: "/tokyo-night.jpg" }}
/>
```

If you omit `night`, night colors are derived from the day image. The two
images should share an aspect ratio so their pixel grids line up.

**Want your city built in?** San Francisco is just the default scene — the
engine doesn't care which skyline it renders. PRs adding cities are very
welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the two-image recipe.

## Pairing with paper shaders

The mosaic's sky is transparent, so anything you pass to `sky` shows through
behind the buildings — a natural fit for [paper shaders](https://shaders.paper.design/):

```tsx
import { MeshGradient } from "@paper-design/shaders-react";

<SkylineMosaic
  mode="night"
  sky={<MeshGradient style={{ width: "100%", height: "100%" }} colors={["#10162e", "#3a1e4d", "#0a0a16"]} />}
/>
```

## Notes

- Server components: mark the parent `"use client"` in the Next.js app router.
- The bundled scenes are regenerated from `assets-src/` via `npm run assets`.

## License

MIT
