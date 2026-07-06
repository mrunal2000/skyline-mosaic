# Changelog

## 0.6.0

The "high craft" release — the goal: stop looking like a filter on a photo.

### Added

- **Building-aware reveal.** The skyline is segmented into buildings from its
  rooftop profile; all three transitions now choreograph per building, with
  floors lighting bottom-up — the city turns on like a city.
- **Discrete window behavior.** With `twinkle`, windows now switch on and off
  like someone flipped a switch (held states, eased changes) instead of
  wobbling sinusoidally. Bloom follows each window's actual state.
- **Red aviation beacons** blink on the tallest towers (night + `twinkle`).
- **Fog glows.** At night a faint bloom is re-laid over the fog bank, so the
  fog catches the city light; fog drift now breathes in wind gusts.
- **`clouds`.** Patchy noise-built clouds drift through the day sky on the
  same wind system — and the cursor gently parts them.

### Changed

- **Art-directed day palette.** Day cells are split-toned (slate-teal
  shadows → warm-paper highlights) instead of echoing the photo's colors.

## 0.5.0

### Changed

- **`effect="shimmer"` replaced with `effect="halftone"`.** The specular
  sweep is gone; halftone renders each cell as a print-style dot sized by ink
  coverage (darker cells = bigger dots in day, brighter = bigger at night).
  Unlike shimmer it settles and stops the render loop, and it pulses with
  `twinkle` at night. Update any `effect="shimmer"` usage to `"halftone"` (or
  `"mosaic"`).

## 0.4.1

- Add repository, homepage, and bugs metadata so the npm page links to GitHub.

## 0.4.0

The big rework. The renderer was rebuilt around a framework-free engine
(`SkylineEngine`) with the React component as a thin driver — groundwork for
future Vue/Svelte wrappers.

### Added

- `effect` prop: `"mosaic"` (default), `"dither"` (ordered Bayer dithering
  with `grid`/`shape`/`levels` options), and `"shimmer"` (specular sweep).
- `transition` prop: choreograph the reveal — `"dissolve"`, `"sweep"`, or
  `"rise"` (lights climb floor by floor).
- `mode="auto"`: follows the OS `prefers-color-scheme`, switching live.
- `twinkle`: lit windows sparkle irregularly at night; bloom halos breathe
  with the same waveform.
- `fog`: volumetric fog bank — two decorrelated fractal-noise layers
  scrolling at different speeds, denser in day mode. Works day and night.
- `sky` slot: render anything (e.g. a paper-shaders gradient) behind the
  transparent skyline.
- `cellGap` prop (defaults to 1 — the signature mosaic grid).
- `scene` prop accepting a custom `{ day, night? }` image pair; night colors
  are derived from the day image when no night image is provided.
- `pauseWhenOffscreen` (default on): rendering pauses offscreen and in
  background tabs.

### Changed

- **Bundle: ~600KB → ~140KB.** Scene images re-encoded as WebP data URIs.
- Type declarations: 294KB → 5KB (data URIs no longer inlined as literal
  types).
- Mode switches crossfade cell-by-cell instead of blanking and rebuilding.
- Cells fade in individually (eased) instead of popping.
- Night bloom rewritten from per-cell `shadowBlur` (slow) to cached
  radial-gradient sprites composited additively — dramatically faster.
- The render loop stops when the scene settles instead of running forever.
- Resizing re-samples without replaying the intro.
- Respects `prefers-reduced-motion` (instant reveal, no twinkle/fog drift).

### Removed

- The experimental cursor-interactive mode.
- The bundled Painted Ladies scene (source retained in `assets-src/`; may
  return).

## 0.3.1

Initial public release: animated pixel-mosaic SF skyline with day/night
modes and a city-lights bloom, images inlined as base64 data URIs.
