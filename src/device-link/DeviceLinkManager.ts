import { invoke } from "@tauri-apps/api/core";
import { AndroidLanSocket, discoverAndroidLanPeers } from "@/device-link/androidLan";
import { LocalDeviceLink } from "@/device-link/LocalDeviceLink";
import {
  signalPairedDevice, subscribeDeviceLinkWakes, type DeviceLinkWakeFamily,
} from "@/device-link/cloudSignaling";
import { isEphemeral, type CompanionAssistantPhase, type DeviceLinkEnvelope, type DeviceLinkPayload, type DeviceLinkState } from "@/device-link/protocol";
import { isPointerSample, type PointerSample } from "@/companion/companionGeometry";
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
  private lastPeerMessage = new Map<string, number>();
  private listeners = new Set<() => void>();
  private wakeHandlers = new Set<(family: DeviceLinkWakeFamily, id: string) => void>();
  private companionListeners = new Set<(senderId: string, payload: DeviceLinkPayload) => void>();
  private companionRequesters = new Map<string, number>();
  private companionOpen = false;
  private companionTimer: ReturnType<typeof setInterval> | null = null;
  private companionRenew: ReturnType<typeof setInterval> | null = null;
  private companionSamplePending = false;
  private lastMonitorLayout = "";
  private lastPointer = "";
  private companionPhase: CompanionAssistantPhase = "idle";
  private cloudUnsubscribe: (() => void) | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private trustTimer: ReturnType<typeof setInterval> | null = null;
  private trustVerifiedAt = 0;
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

  /** No pointer data is stored or included in the cloud fallback. */
  subscribeCompanion(listener: (senderId: string, payload: DeviceLinkPayload) => void): () => void {
    this.companionListeners.add(listener);
    return () => this.companionListeners.delete(listener);
  }

  setCompanionOpen(open: boolean): void {
    if (this.platform !== "android") return;
    if (this.companionOpen === open) return;
    this.companionOpen = open;
    if (this.companionRenew) clearInterval(this.companionRenew);
    this.companionRenew = null;
    void this.announceCompanion(open ? "start" : "stop");
    if (open) this.companionRenew = setInterval(() => {
      void this.announceCompanion("start");
    }, 4_000);
  }

  private async announceCompanion(action: "start" | "stop"): Promise<void> {
    for (const peer of this.pairs) {
      if (!this.sessions.get(peer.peerDeviceId)?.connected) continue;
      void this.sendEphemeral(peer.peerDeviceId, { type: "companion", action });
    }
  }

  /** Only a visible, authenticated LAN companion may activate Windows sampling. */
  private async sampleCompanion(): Promise<void> {
    if (this.platform !== "windows" || this.companionSamplePending) return;
    const now = Date.now();
    for (const [id, expiry] of this.companionRequesters) {
      if (expiry < now || !this.sessions.get(id)?.connected) this.companionRequesters.delete(id);
    }
    if (!this.companionRequesters.size) {
      if (this.companionTimer) clearInterval(this.companionTimer);
      this.companionTimer = null;
      return;
    }
    this.companionSamplePending = true;
    try {
      const sample: unknown = await invoke("companion_pointer_sample");
      if (!isPointerSample(sample)) return;
      const { x, y, monitors } = sample as PointerSample;
      const layout = JSON.stringify(monitors);
      for (const peerId of this.companionRequesters.keys()) {
        if (layout !== this.lastMonitorLayout) {
          await this.sendEphemeral(peerId, { type: "layout", monitors });
        }
        const pointerKey = `${x}:${y}`;
        if (pointerKey !== this.lastPointer || layout !== this.lastMonitorLayout) {
          await this.sendEphemeral(peerId, { type: "cursor", x, y });
        }
      }
      this.lastMonitorLayout = layout;
      this.lastPointer = `${x}:${y}`;
    } catch {
      // Permission, desktop switching and device disconnects must fail quietly.
    } finally {
      this.companionSamplePending = false;
    }
  }

  publishCompanionAssistant(phase: CompanionAssistantPhase): void {
    if (this.companionPhase === phase) return;
    this.companionPhase = phase;
    if (this.platform !== "windows") return;
    for (const peerId of this.companionRequesters.keys()) {
      void this.sendEphemeral(peerId, { type: "assistant-state", phase });
    }
  }

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
    this.lastPeerMessage.set(frame.sender, Date.now());
    if (frame.payload.type === "companion" && this.platform === "windows") {
      if (frame.payload.action === "start") {
        const first = !this.companionRequesters.has(frame.sender);
        this.companionRequesters.set(frame.sender, Date.now() + 12_000);
        if (first) {
          // Deliver current state immediately on activation and after reconnect.
          void this.sendEphemeral(frame.sender, { type: "assistant-state", phase: this.companionPhase });
          this.lastMonitorLayout = "";
          this.lastPointer = "";
          void this.sampleCompanion();
        }
        if (!this.companionTimer) this.companionTimer = setInterval(() => {
          void this.sampleCompanion();
        }, 80);
      } else {
        this.companionRequesters.delete(frame.sender);
      }
    } else if (this.platform === "android" &&
      (frame.payload.type === "cursor" || frame.payload.type === "layout" ||
       frame.payload.type === "assistant-state")) {
      if (!this.companionOpen) return;
      for (const cb of this.companionListeners) cb(frame.sender, frame.payload);
    }
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
      this.trustVerifiedAt = Date.now();
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
        this.scanTimer = setInterval(() => {
          for (const peer of this.pairs) this.connectWindows(peer);
        }, 8_000);
      } else {
        await this.scanAndroid(generation);
        this.scanTimer = setInterval(() => { void this.scanAndroid(generation); }, 8_000);
      }
      this.trustTimer = setInterval(() => { void this.recheckTrust(generation); }, 20_000);
      this.heartbeatTimer = setInterval(() => {
        for (const [peerId, session] of this.sessions) {
          if (!session.connected) continue;
          const seen = this.lastPeerMessage.get(peerId) ?? 0;
          if (seen && Date.now() - seen > 45_000) {
            this.disconnectPeer(peerId);
            continue;
          }
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

  private async recheckTrust(generation: number): Promise<void> {
    if (!this.deviceId || generation !== this.generation) return;
    try {
      const updated = (await verifiedPairLinks(this.deviceId)).filter(link => !!link.peerPublicKey);
      if (generation !== this.generation) return;
      this.trustVerifiedAt = Date.now();
      const active = new Set(updated.map(link => link.peerDeviceId));
      for (const peer of this.sessions.keys()) {
        if (!active.has(peer)) this.disconnectPeer(peer);
      }
      this.pairs = updated;
      if (this.pairs.length === 0) { this.stop(); return; }
      if (this.platform === "windows") {
        for (const peer of this.pairs) this.connectWindows(peer);
      }
      this.update();
    } catch {
      // Offline LAN may temporarily continue, but no new sessions may be
      // established without a recent verified pairing. Eventually fail closed.
      if (Date.now() - this.trustVerifiedAt > 120_000) {
        for (const peer of [...this.sessions.keys()]) this.disconnectPeer(peer);
      }
    }
  }

  private connectWindows(peer: PairLink): void {
    if (!this.deviceId || !peer.peerPublicKey || !this.relayPort) return;
    if (this.sessions.has(peer.peerDeviceId) || this.connecting.has(peer.peerDeviceId)
      || Date.now() - this.trustVerifiedAt > 35_000) return;
    this.connecting.add(peer.peerDeviceId);
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${this.relayPort}/device-link`);
      const session = new LocalDeviceLink({
        socket, deviceId: this.deviceId, peerId: peer.peerDeviceId, peerIdentity: peer.peerPublicKey,
        onMessage: frame => this.deliver(frame),
        onState: state => {
          if (state === "connected") {
            this.lastPeerMessage.set(peer.peerDeviceId, Date.now());
            this.update();
            if (this.companionOpen) void this.sendEphemeral(peer.peerDeviceId, { type: "companion", action: "start" });
          }
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
          || this.connecting.has(peer.deviceId)
          || Date.now() - this.trustVerifiedAt > 35_000) continue;
        this.connecting.add(peer.deviceId);
        try {
          const socket = new AndroidLanSocket(peer.host, peer.port);
          const session = new LocalDeviceLink({
            socket, deviceId: this.deviceId, peerId: peer.deviceId,
            peerIdentity: pairing.peerPublicKey,
            onMessage: frame => this.deliver(frame),
            onState: state => {
              if (state === "connected") {
                this.lastPeerMessage.set(peer.deviceId, Date.now());
                this.update();
                if (this.companionOpen) void this.sendEphemeral(peer.deviceId, { type: "companion", action: "start" });
              }
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
    this.lastPeerMessage.delete(peerId);
    this.companionRequesters.delete(peerId);
    this.lastMonitorLayout = "";
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
    if (!isEphemeral(payload)) return false;
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
    if (this.trustTimer) clearInterval(this.trustTimer);
    if (this.companionTimer) clearInterval(this.companionTimer);
    if (this.companionRenew) clearInterval(this.companionRenew);
    this.scanTimer = null;
    this.heartbeatTimer = null;
    this.trustTimer = null;
    this.companionTimer = null;
    this.companionRenew = null;
    this.companionOpen = false;
    this.companionRequesters.clear();
    this.lastMonitorLayout = "";
    this.lastPointer = "";
    this.companionSamplePending = false;
    this.companionPhase = "idle";
    this.cloudUnsubscribe?.();
    this.cloudUnsubscribe = null;
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
    this.connecting.clear();
    this.lastPeerMessage.clear();
    if (this.relayPort !== null) void invoke("device_link_stop_relay").catch(() => undefined);
    this.relayPort = null;
    this.cloudReady = false;
    this.trustVerifiedAt = 0;
    this.pairs = [];
    this.deviceId = null;
    this.userId = null;
    this.platform = null;
    this.snapshot = INITIAL;
    this.emit();
  }
}

export const deviceLinkManager = new DeviceLinkManager();
