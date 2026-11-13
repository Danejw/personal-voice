import { useCallback, useEffect, useState } from "react";
import {
  createEnvironment, deleteEnvironment, listEnvironments, renameEnvironment,
  selectEnvironment, setEnvironmentPalette, type EnvironmentSnapshot,
} from "@/services/spatialEnvironments";
import { DEFAULT_WORLD, type WorldPalette } from "@/desktopBackground/worldConfig";
import type { WindowsPlatformAdapter } from "./WindowsPlatformAdapter";

export function EnvironmentManager({ platform }: { platform: WindowsPlatformAdapter }) {
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot>({ environments: [], activeId: null });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await listEnvironments();
      setSnapshot(next);
      setSignedOut(false);
    } catch (reason) {
      setSnapshot({ environments: [], activeId: null });
      setSignedOut(true);
      setError(String(reason));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await operation(); await refresh(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  const active = snapshot.environments.find(world => world.id === snapshot.activeId);
  return <section aria-label="Your 3D environments">
    <h3>My environments</h3>
    {signedOut ? <p>Sign in to create and sync private environments. The default background still works without an account.</p> : <>
      <p>Each environment has its own saved identity and appearance. Only the active world is rendered.</p>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const created = await createEnvironment(name, DEFAULT_WORLD);
          await selectEnvironment(created.id);
          await platform.setDesktopEnvironment(created.scene_config);
          setName("");
        });
      }}>
        <input aria-label="New environment name" placeholder="New environment name" value={name}
          maxLength={80} onChange={event => setName(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || !name.trim()}>Create</button>
      </form>
      {snapshot.environments.map(world => <div key={world.id}>
        <label>
          <input type="radio" name="active-environment" checked={snapshot.activeId === world.id}
            disabled={busy} onChange={() => void run(async () => {
              await selectEnvironment(world.id);
              await platform.setDesktopEnvironment(world.scene_config);
            })} />
          {world.name}
        </label>
        <select aria-label={`Color palette for ${world.name}`} value={world.scene_config.palette} disabled={busy}
          onChange={event => void run(async () => {
            const palette = event.target.value as WorldPalette;
            await setEnvironmentPalette(world.id, palette);
            if (world.id === snapshot.activeId) await platform.setDesktopEnvironment({ kind: "terrain", palette });
          })}>
          <option value="cyan">Cyan</option>
          <option value="violet">Violet</option>
          <option value="amber">Amber</option>
        </select>
        <button type="button" disabled={busy} onClick={() => {
          const updated = window.prompt("Rename environment", world.name);
          if (updated !== null) void run(() => renameEnvironment(world.id, updated));
        }}>Rename</button>
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Delete "${world.name}" and its saved objects? This cannot be undone.`)) {
            void run(async () => {
              await deleteEnvironment(world.id);
              if (snapshot.activeId === world.id) await platform.setDesktopEnvironment(DEFAULT_WORLD);
            });
          }
        }}>Delete</button>
      </div>)}
      {!snapshot.environments.length && <p>No saved environments yet.</p>}
      {active && <p role="status">Selected: {active.name}</p>}
    </>}
    {error && !signedOut && <p className="error" role="alert">{error}</p>}
  </section>;
}
