import { invoke } from "@tauri-apps/api/core";
import { AndroidLanSocket, discoverAndroidLanPeers } from "@/device-link/androidLan";
import { LocalDeviceLink } from "@/device-link/LocalDeviceLink";
import {
  signalPairedDevice, subscribeDeviceLinkWakes, type DeviceLinkWakeFamily,
} from "@/device-link/cloudSignaling";
import { type DeviceLinkEnvelope, type DeviceLinkPayload, type DeviceLinkState } from "@/device-link/protocol";
import { devicePairingApi, type PairLink } from "@/services/devicePairingService";
import { verifiedPairLinks } from "@/services/verifiedPairLinks";

export interface DeviceLinkSnapshot {
  state: DeviceLinkState;
  localPeers: string[];
  pairedPeers: string[];
}
const INITIAL: DeviceLinkSnapshot = { state: "offline", localPeers: [], pairedPeers: [] };

/** One DeviceLink controller per app process. Cloud is signaling, never a second action queue.
 * Existing remote-dictation and tool RPC claim-and-ack remains authoritative.
 */
export class DeviceLinkManager {
  private snapshot: DeviceLinkSnapshot = INITIAL;
  private deviceId: string | null = null;
  private userId: string | null = null;
  private platform: "windows" | "android" | null = null;
  private pairs: PairLink[] = [];
  private sessions = new Map<string, LocalDeviceLink>();
  private connecting = new Set<string>();
  private listeners = new Set<() => void>();
  private wakeHandlers = new Set<(family: DeviceLinkWakeFamily, id: string) => void>();
  private cloudUnsubscribe: (() => void) | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private cloudReady = false;
  private relayPort: number | null = null;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  subscribeWakes(cb: (family: DeviceLinkWakeFamily, requestId: string) => void): () => void {
    this.wakeHandlers.add(cb);
    return () => this.wakeHandlers.delete(cb);
  }
  getSnapshot = () => this.snapshot;

  private emit() { for (const listener of this.listeners) listener(); }
  private update() {
    const localPeers = [...this.sessions].filter(([, session]) => session.connected).map(([id]) => id);
    const state: DeviceLinkState = !this.deviceId ? "offline"
      : localPeers.length ? "local"
        : this.cloudReady ? "remote" : this.pairs.length ? "reconnecting" : "offline";
    this.snapshot = { state, localPeers, pairedPeers: this.pairs.map(x => x.peerDeviceId) };
    this.emit();
  }
  private deliver(frame: DeviceLinkEnvelope) {
    if (frame.payload.type === "wake") {
      for (const cb of this.wakeHandlers) cb(frame.payload.family, frame.payload.requestId);
    }
  }
  async start(userId: string | null, deviceId: string | null, platform: string): Promise<void> {
    this.stop();
    if (!userId || !deviceId || (platform !== "windows" && platform !== "android")) return;
    const generation = this.generation;
    this.userId = userId;
    this.deviceId = deviceId;
    this.platform = platform;
    this.snapshot = { state: "connecting", localPeers: [], pairedPeers: [] };
    this.emit();
    try {
      await devicePairingApi.register(deviceId);
      const pairs = await verifiedPairLinks(deviceId);
      if (generation !== this.generation) return;
      this.pairs = pairs.filter(p => !!p.peerPublicKey);
      if (this.pairs.length === 0) { this.update(); return; }
      this.cloudUnsubscribe = subscribeDeviceLinkWakes(userId, deviceId,
        wake => {
          // The recipient still fetches the canonical request row before executing.
          if (!this.pairs.some(p => p.peerDeviceId === wake.senderDeviceId)) return;
          for (const cb of this.wakeHandlers) cb(wake.family, wake.requestId);
        },
        ready => { if (generation === this.generation) { this.cloudReady = ready; this.update(); } },
      );
      if (platform === "windows") {
        this.relayPort = await invoke<number>("device_link_start_relay", { deviceId });
        if (generation !== this.generation) return;
        for (const peer of this.pairs) this.connectWindows(peer);
      } else {
        await this.scanAndroid(generation);
        this.scanTimer = setInterval(() => { void this.scanAndroid(generation); }, 8_000);
      }
      this.heartbeatTimer = setInterval(() => {
        for (const [peerId, session] of this.sessions) {
          if (!session.connected) continue;
          void session.send({ type: "presence", state: "ready" }).catch(() => this.disconnectPeer(peerId));
        }
      }, 15_000);
      this.update();
    } catch {
      if (generation === this.generation) this.update();
    }
  }

  async refresh(): Promise<void> {
    if (this.userId && this.deviceId && this.platform) {
      await this.start(this.userId, this.deviceId, this.platform);
    }
  }

  private connectWindows(peer: PairLink): void {
    if (!this.deviceId || !peer.peerPublicKey || !this.relayPort) return;
    if (this.sessions.has(peer.peerDeviceId) || this.connecting.has(peer.peerDeviceId)) return;
    this.connecting.add(peer.peerDeviceId);
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${this.relayPort}/device-link`);
      const session = new LocalDeviceLink({
        socket, deviceId: this.deviceId, peerId: peer.peerDeviceId, peerIdentity: peer.peerPublicKey,
        onMessage: frame => this.deliver(frame),
        onState: state => {
          if (state === "connected") this.update();
          if (state === "closed") this.disconnectPeer(peer.peerDeviceId);
        },
      });
      this.sessions.set(peer.peerDeviceId, session);
      this.connecting.delete(peer.peerDeviceId);
    } catch { this.connecting.delete(peer.peerDeviceId); }
  }

  private async scanAndroid(generation: number): Promise<void> {
    if (generation !== this.generation || !this.deviceId) return;
    try {
      const discovered = await discoverAndroidLanPeers();
      if (generation !== this.generation) return;
      for (const peer of discovered) {
        const pairing = this.pairs.find(item => item.peerDeviceId === peer.deviceId);
        if (!pairing?.peerPublicKey || this.sessions.has(peer.deviceId)
          || this.connecting.has(peer.deviceId)) continue;
        this.connecting.add(peer.deviceId);
        try {
          const socket = new AndroidLanSocket(peer.host, peer.port);
          const session = new LocalDeviceLink({
            socket, deviceId: this.deviceId, peerId: peer.deviceId,
            peerIdentity: pairing.peerPublicKey,
            onMessage: frame => this.deliver(frame),
            onState: state => {
              if (state === "connected") this.update();
              if (state === "closed") this.disconnectPeer(peer.deviceId);
            },
          });
          this.sessions.set(peer.deviceId, session);
        } finally { this.connecting.delete(peer.deviceId); }
      }
      this.update();
    } catch { /* Offline and Wi-Fi switching are expected. Cloud wake remains available. */ }
  }

  private disconnectPeer(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (!session) return;
    this.sessions.delete(peerId);
    session.stop();
    this.update();
  }

  /** Wake hints never constitute execution confirmation. Reliable actions stay in the existing RPCs. */
  async sendWake(targetDeviceId: string, family: DeviceLinkWakeFamily, requestId: string): Promise<void> {
    const from = this.deviceId;
    if (!from || !this.pairs.some(p => p.peerDeviceId === targetDeviceId)) return;
    const local = this.sessions.get(targetDeviceId);
    if (local?.connected) {
      try {
        await local.send({ type: "wake", family, requestId });
        return;
      } catch { this.disconnectPeer(targetDeviceId); }
    }
    await signalPairedDevice(from, targetDeviceId, family, requestId);
  }

  /** High-frequency presence/cursor updates are strictly LAN-only. */
  async sendEphemeral(targetDeviceId: string, payload: DeviceLinkPayload): Promise<boolean> {
    if (payload.type !== "presence" && payload.type !== "cursor") return false;
    if (!this.pairs.some(p => p.peerDeviceId === targetDeviceId)) return false;
    const session = this.sessions.get(targetDeviceId);
    if (!session?.connected) return false;
    try { await session.send(payload); return true; } catch {
      this.disconnectPeer(targetDeviceId);
      return false;
    }
  }

  stop(): void {
    this.generation++;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.scanTimer = null;
    this.heartbeatTimer = null;
    this.cloudUnsubscribe?.();
    this.cloudUnsubscribe = null;
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
    this.connecting.clear();
    if (this.relayPort !== null) void invoke("device_link_stop_relay").catch(() => undefined);
    this.relayPort = null;
    this.cloudReady = false;
    this.pairs = [];
    this.deviceId = null;
    this.userId = null;
    this.platform = null;
    this.snapshot = INITIAL;
    this.emit();
  }
}

export const deviceLinkManager = new DeviceLinkManager();
