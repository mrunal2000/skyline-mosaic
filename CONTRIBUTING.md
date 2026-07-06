# Contributing

The most wanted contribution: **add your city.** The engine is
scene-agnostic — San Francisco is just the built-in default. A new city is
two images and three small edits.

## Adding a city

### 1. Source your images

- **Day image (required):** a PNG with a **transparent sky** — the alpha
  channel is what defines the skyline silhouette. Side-on panoramas work
  best: buildings against open sky, wide-strip composition (aspect ratio
  around 3:1), at least 1600px wide, shot from water level or a rooftop
  rather than aerial.
- **Night image (optional but worth it):** the same vantage at night,
  cropped to the **same aspect ratio** so the pixel grids align — that's
  where the real lit-window colors come from. If you skip it, night colors
  are derived from the day image automatically (dark buildings + warm
  window glow), which looks good but generic.
- **Licensing (non-negotiable):** you must have the right to redistribute
  the pixels — your own photo, CC0, or a license permitting inclusion in an
  MIT package. Credit the photographer in your PR and the README. Images
  "found online" can't be merged.

### 2. Drop them into `assets-src/`

Name them `<city>-day.png` and `<city>-night.jpg` (e.g. `tokyo-day.png`).

### 3. Register the scene

- `scripts/convert-assets.mjs` — add entries to the `SCENES` array:

  ```js
  { key: "TOKYO_DAY", file: "tokyo-day.png", quality: 82 },
  { key: "TOKYO_NIGHT", file: "tokyo-night.jpg", quality: 78 },
  ```

- Run `npm run assets`. It re-encodes to WebP data URIs and regenerates
  `src/assets.ts`. Check the printed sizes — a scene should stay under
  ~130KB of base64 total; drop the `quality` a few points if it doesn't.

- `src/scenes.ts` — add the scene name and its images:

  ```ts
  export type SceneName = "sf" | "tokyo";

  export const SCENES: Record<SceneName, SceneImages> = {
    sf: { day: SF_DAY_DATA_URI, night: SF_NIGHT_DATA_URI },
    tokyo: { day: TOKYO_DAY_DATA_URI, night: TOKYO_NIGHT_DATA_URI },
  };
  ```

### 4. Check it

`npm run build`, then point any React sandbox at
`<SkylineMosaic scene="tokyo" mode="night" twinkle />` and sanity-check:

- Day: silhouette is clean, no haloing where the sky was cut out.
- Night: lit windows land on the buildings (grids aligned), bloom looks
  intentional, the water/base row isn't glowing.

Include a day + night screenshot in the PR.

## Everything else

Bug fixes and features welcome — keep PRs focused. The rendering core is
`src/engine.ts` (framework-free); `src/SkylineMosaic.tsx` should stay a thin
React driver over it. Run `npm run build` and `npx tsc --noEmit` before
sending.
