import { nativeSignPairingText, type PublicPairingKey } from "@/devices/pairingIdentity";
import {
  startLocalHandshake, verifyLocalHello, sharedLocalSessionKey, LocalCipher,
  type LocalHello, type EncryptedWireFrame,
} from "@/device-link/localCrypto";
import { DeviceLinkSeenIds, makeEnvelope, parseDeviceLinkEnvelope, type DeviceLinkPayload, type DeviceLinkEnvelope } from "@/device-link/protocol";

export type LocalConnectionState = "connecting" | "connected" | "closed";
export interface LocalSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(event: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(event: "close" | "error" | "open", listener: () => void): void;
}
export interface LocalConnectorOptions {
  socket: LocalSocket;
  deviceId: string;
  peerId: string;
  peerIdentity: PublicPairingKey;
  onMessage(frame: DeviceLinkEnvelope): void;
  onState(state: LocalConnectionState): void;
}

/** LAN payloads are AES-GCM sealed. Untrusted WebSocket endpoints never receive commands in plaintext. */
export class LocalDeviceLink {
  private own: Awaited<ReturnType<typeof startLocalHandshake>> | null = null;
  private peerHello: LocalHello | null = null;
  private cipher: LocalCipher | null = null;
  private closed = false;
  private seen = new DeviceLinkSeenIds();
  private handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  private pending: DeviceLinkPayload[] = [];

  constructor(private options: LocalConnectorOptions) {
    options.socket.addEventListener("open", () => { void this.begin(); });
    options.socket.addEventListener("message", event => { void this.handle(event.data); });
    options.socket.addEventListener("close", () => this.stop());
    options.socket.addEventListener("error", () => this.stop());
    if (options.socket.readyState === 1) void this.begin();
  }

  get connected(): boolean { return this.cipher !== null && !this.closed; }

  private async begin(): Promise<void> {
    if (this.closed || this.own) return;
    try {
      const own = await startLocalHandshake(
        this.options.deviceId, this.options.peerId,
        message => nativeSignPairingText(this.options.deviceId, message),
      );
      if (this.closed) return;
      this.own = own;
      this.options.socket.send(JSON.stringify(own.hello));
      this.handshakeTimeout = setTimeout(() => this.stop(), 8_000);
      if (this.peerHello) await this.finishHandshake();
    } catch { this.stop(); }
  }

  private async handle(raw: unknown): Promise<void> {
    if (this.closed || typeof raw !== "string" || new TextEncoder().encode(raw).length > 16_384) {
      this.stop(); return;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { this.stop(); return; }
    const kind = parsed && typeof parsed === "object" ? (parsed as { kind?: unknown }).kind : null;
    if (kind === "hello" && !this.peerHello && !this.cipher) {
      const verified = await verifyLocalHello(
        parsed, this.options.peerId, this.options.deviceId, this.options.peerIdentity,
      );
      if (!verified || this.closed) { this.stop(); return; }
      this.peerHello = verified;
      if (this.own) await this.finishHandshake();
    } else if (kind === "sealed" && this.cipher) {
      const received = await this.cipher.open(parsed);
      if (!received) { this.stop(); return; }
      if (this.seen.accept(received)) this.options.onMessage(received);
    } else this.stop();
  }

  private async finishHandshake(): Promise<void> {
    if (!this.own || !this.peerHello || this.cipher || this.closed) return;
    try {
      const key = await sharedLocalSessionKey(this.own.secret, this.own.hello, this.peerHello);
      this.cipher = new LocalCipher(key, this.options.deviceId, this.options.peerId);
      if (this.handshakeTimeout) clearTimeout(this.handshakeTimeout);
      this.handshakeTimeout = null;
      this.options.onState("connected");
      const queued = this.pending.splice(0);
      for (const payload of queued) await this.send(payload);
    } catch { this.stop(); }
  }

  async send(payload: DeviceLinkPayload): Promise<void> {
    if (this.closed) throw new Error("DeviceLink local connection is closed.");
    if (!this.cipher) {
      if (this.pending.length >= 8) throw new Error("DeviceLink connection is not ready.");
      this.pending.push(payload);
      return;
    }
    const frame = makeEnvelope(this.options.deviceId, this.options.peerId, payload);
    if (!parseDeviceLinkEnvelope(frame)) throw new Error("Invalid DeviceLink frame.");
    const sealed: EncryptedWireFrame = await this.cipher.seal(frame);
    this.options.socket.send(JSON.stringify(sealed));
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.cipher = null;
    this.own = null;
    this.peerHello = null;
    this.seen.clear();
    this.pending = [];
    if (this.handshakeTimeout) clearTimeout(this.handshakeTimeout);
    this.handshakeTimeout = null;
    try { this.options.socket.close(1000, "DeviceLink disconnected"); } catch { /* already closed */ }
    this.options.onState("closed");
  }
}
