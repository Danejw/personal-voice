import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(), setWorld: vi.fn(), dispose: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined),
  listener: undefined as undefined | ((event: { payload: { x: number; y: number; z: number } }) => void),
}));
vi.mock("./scene", () => ({ createTerrainView: () => ({ render: mocks.render, setWorld: mocks.setWorld, dispose: mocks.dispose }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (_name: string, handler: typeof mocks.listener) => {
  mocks.listener = handler;
  return vi.fn();
} }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("background redraw delivery", () => {
  it.each([0, 1, 2])("renders head movement on monitor %i even when animation callbacks are suspended", async index => {
    vi.resetModules();
    vi.useFakeTimers();
    const suspendedAnimation = vi.fn(); // An occluded WebView never invokes its callback.
    vi.stubGlobal("requestAnimationFrame", suspendedAnimation);
    vi.stubGlobal("window", {
      __PV_BACKGROUND__: { index, monitors: [
        { x: -2560, y: 159, width: 2560, height: 1440, scale: 1 },
        { x: 0, y: 0, width: 2560, height: 1440, scale: 1 },
        { x: 2560, y: 264, width: 1920, height: 1080, scale: 1 },
      ] }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { hidden: true, querySelector: () => ({}),
      addEventListener: vi.fn(), removeEventListener: vi.fn() });
    await import("./main");
    expect(mocks.render).toHaveBeenCalledTimes(1);
    const movement = { x: 0.4, y: -0.2, z: 0.1 };
    mocks.listener!({ payload: movement });
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.lastCall?.[1]).toEqual(movement);
    expect(suspendedAnimation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(701);
    expect(mocks.render.mock.lastCall?.[1]).toEqual({ x: 0, y: 0, z: 0 });
  });
});
