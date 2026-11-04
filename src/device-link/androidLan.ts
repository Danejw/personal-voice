import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";
import type { LocalSocket } from "@/device-link/LocalDeviceLink";

export interface DiscoveredLanPeer { deviceId: string; host: string; port: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateIp = (host: string): boolean => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some(n => n > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254);
};
export function parseDiscoveredPeer(value: unknown): DiscoveredLanPeer | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.deviceId !== "string" || !uuid.test(v.deviceId)
    || typeof v.host !== "string" || !privateIp(v.host)
    || typeof v.port !== "number" || !Number.isInteger(v.port)
    || v.port < 1024 || v.port > 65535) return null;
  return { deviceId: v.deviceId, host: v.host, port: v.port };
}

/** This scanner returns locators only. Never regard discovery as proof of pairing. */
export async function discoverAndroidLanPeers(): Promise<DiscoveredLanPeer[]> {
  const result = await callPlugin<{ peers: unknown[] }>("device_link_discover");
  if (!Array.isArray(result?.peers)) throw new Error("LAN discovery returned no valid peers.");
  return result.peers.flatMap(item => {
    const peer = parseDiscoveredPeer(item);
    return peer ? [peer] : [];
  });
}

type EventType = "open" | "close" | "error" | "message";

/** Adapter for the Android plugin's native socket, with the same event shape as WebSocket. */
export class AndroidLanSocket implements LocalSocket {
  readyState = 0;
  private closed = false;
  private listeners = new Map<EventType, Set<(event: MessageEvent) => void>>();
  private disposers: Array<() => void> = [];

  constructor(private host: string, private port: number) {
    if (!privateIp(host) || port < 1024 || port > 65535) {
      throw new Error("LAN connection must use a private network address.");
    }
    void this.begin();
  }

  addEventListener(event: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(event: "close" | "error" | "open", listener: () => void): void;
  addEventListener(event: EventType, listener: (event: MessageEvent) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  private emit(type: EventType, data = "") {
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent);
  }

  private async begin(): Promise<void> {
    try {
      const [open, msg, close] = await Promise.all([
        listenPlugin("deviceLinkOpen", () => {
          if (this.closed) return;
          this.readyState = 1;
          this.emit("open");
        }),
        listenPlugin("deviceLinkMessage", (payload) => {
          const msg = payload && typeof payload === "object"
            ? (payload as { message?: unknown }).message : null;
          if (!this.closed && typeof msg === "string") this.emit("message", msg);
        }),
        listenPlugin("deviceLinkClosed", () => this.end()),
      ]);
      this.disposers = [open, msg, close];
      if (this.closed) { this.end(); return; }
      await callPlugin("device_link_connect", { host: this.host, port: this.port });
    } catch { this.emit("error"); this.end(); }
  }

  send(data: string): void {
    if (this.closed || this.readyState !== 1) throw new Error("LAN is disconnected.");
    void callPlugin("device_link_send", { message: data }).catch(() => this.end());
  }

  close(): void { this.end(); }
  private end(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    void callPlugin("device_link_close").catch(() => undefined);
    for (const dispose of this.disposers.splice(0)) dispose();
    this.emit("close");
  }
}
