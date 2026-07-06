import { SF_DAY_DATA_URI, SF_NIGHT_DATA_URI } from "./assets";

export type SceneImages = {
  /** Transparent-background image whose alpha defines where the buildings are. */
  day: string;
  /**
   * Night image sampled for lit-window colors. If omitted, night colors are
   * derived from the day image (dark buildings + warm glow on bright areas).
   */
  night?: string;
};

/** Built-in scene names shipped with the package. */
export type SceneName = "sf";

export const SCENES: Record<SceneName, SceneImages> = {
  sf: { day: SF_DAY_DATA_URI, night: SF_NIGHT_DATA_URI },
};

export const DEFAULT_SCENE: SceneName = "sf";

/**
 * Resolve whatever the caller passed for `scene` into concrete image sources.
 * Accepts a built-in scene name, a custom `{ day, night }` pair, or `undefined`
 * (falls back to the default scene). Explicit `dayImageSrc`/`nightImageSrc`
 * props take precedence and are applied by the caller.
 */
export function resolveScene(
  scene: SceneName | SceneImages | undefined
): SceneImages {
  if (!scene) return SCENES[DEFAULT_SCENE];
  if (typeof scene === "string") {
    return SCENES[scene] ?? SCENES[DEFAULT_SCENE];
  }
  return scene;
}
