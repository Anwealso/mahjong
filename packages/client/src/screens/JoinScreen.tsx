import { useState, type FormEvent } from "react";
import { useStore } from "../net/store";

/** Pick a name, then create a room or join one by its code (prefilled from a shared `#CODE` link). */
export function JoinScreen() {
  const { createRoom, joinRoom, status } = useStore();
  const [name, setName] = useState(() => localStorage.getItem("mahjong.name") ?? "");
  const [code, setCode] = useState(() => location.hash.slice(1).toUpperCase());
  const ready = status === "open" && name.trim().length > 0;

  const remember = () => localStorage.setItem("mahjong.name", name.trim());
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || code.trim().length !== 4) return;
    remember();
    joinRoom(code.trim(), name.trim());
  };

  return (
    <main className="panel">
      <h1>雞糊 Chicken Hand</h1>
      <form onSubmit={join}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus />
        </label>
        <label>
          Room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="ABCD"
            className="code"
          />
        </label>
        <div className="buttons">
          <button type="submit" disabled={!ready || code.trim().length !== 4}>
            Join room
          </button>
          <span className="muted">or</span>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              remember();
              createRoom(name.trim());
            }}
          >
            Create a new room
          </button>
        </div>
      </form>
    </main>
  );
}
