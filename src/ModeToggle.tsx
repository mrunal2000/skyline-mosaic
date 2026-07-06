"use client";

import type { CSSProperties } from "react";
import type { SkylineMosaicMode } from "./SkylineMosaic";

export type ModeToggleProps = {
  mode: SkylineMosaicMode;
  onChange: (mode: SkylineMosaicMode) => void;
  /** Positions the button itself. Defaults to fixed, top-right of the viewport. */
  position?: CSSProperties;
  className?: string;
};

/**
 * A small button for switching SkylineMosaic between day/night.
 *
 * Positioned `fixed`, top-right of the viewport by default — pass
 * `position` to override (e.g. `{ position: "absolute", top: 8, right: 8 }`
 * to anchor it inside a small card instead of the whole screen).
 */
export default function ModeToggle({
  mode,
  onChange,
  position,
  className,
}: ModeToggleProps) {
  const isNight = mode === "night";

  return (
    <button
      onClick={() => onChange(isNight ? "day" : "night")}
      className={className}
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 20,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 14,
        borderRadius: 9999,
        padding: "4px 12px",
        border: `1px solid ${isNight ? "#3f3f46" : "#d4d4d8"}`,
        background: isNight ? "rgba(24,24,27,0.6)" : "rgba(255,255,255,0.6)",
        color: isNight ? "#e4e4e7" : "#3f3f46",
        cursor: "pointer",
        transition: "background-color 0.2s, color 0.2s, border-color 0.2s",
        ...position,
      }}
    >
      {isNight ? "☾ night" : "☀︎ day"}
    </button>
  );
}
