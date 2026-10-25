import { useEffect } from "react";
import { useSoundSettings } from "./player";

/** Mute button and volume slider in the top-left corner. `M` toggles mute. */
export function SoundControls() {
  const { volume, muted, setVolume, toggleMute } = useSoundSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "m") return;
      toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

  const silent = muted || volume === 0;
  return (
    <div className="sound-controls">
      <button className="subtle" onClick={toggleMute} title={silent ? "Unmute (M)" : "Mute (M)"} aria-label={silent ? "Unmute" : "Mute"}>
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
    </div>
  );
}
