import { useEffect, useRef, useState } from "react";
import { useSoundSettings } from "./sound/player";

/**
 * A gear button in the top-right corner that opens a small menu of personal settings (saved per browser).
 * `M` toggles mute even while it's closed.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { volume, muted, setVolume, toggleMute } = useSoundSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open && e.key === "Escape") {
        // Close the menu without also passing on a claim.
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.key.toLowerCase() === "m") toggleMute();
    };
    const onClick = (e: PointerEvent) => {
      if (open && !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture, so Escape is handled before the table's shortcuts.
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onClick);
    };
  }, [open, toggleMute]);

  const silent = muted || volume === 0;
  return (
    <div className="settings" ref={ref}>
      <button
        className={`subtle settings-button${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
      >
        <GearIcon />
      </button>
      {open && (
        <div className="settings-menu" role="dialog" aria-label="Settings">
          <h3>Settings</h3>
          <div className="setting">
            <span className="setting-label">Sound</span>
            <button className="subtle" onClick={toggleMute} aria-label={silent ? "Unmute" : "Mute"} title={silent ? "Unmute" : "Mute"}>
              {silent ? "🔇" : volume < 0.4 ? "🔈" : "🔊"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
            <span className="setting-value">{muted ? "Off" : `${Math.round(volume * 100)}%`}</span>
          </div>
          <p className="muted setting-hint">
            <kbd>M</kbd> mutes or unmutes at any time.
          </p>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
