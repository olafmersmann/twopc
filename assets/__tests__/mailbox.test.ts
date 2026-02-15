import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as c from "../crypto";

// --- MockWebSocket ---

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

// Helper: complete the DH handshake as a peer
async function peerHandshake(sharedSecret: CryptoKey) {
  const peerKp = await c.generateDHKeyPair();
  const pk = await crypto.subtle.exportKey("jwk", peerKp.publicKey);
  const sig = await c.signPk(sharedSecret, peerKp.publicKey);
  return { type: "handshake", pk, sig };
}

// Helper: create a Mailbox and drive it to ESTABLISHED state
async function establishMailbox(Mailbox: typeof import("../mailbox").Mailbox, sharedSecret: CryptoKey) {
  const baseline = MockWebSocket.instances.length;
  const mailbox = new Mailbox("ws://localhost/test", sharedSecret);
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  mailbox.onConnect = onConnect;
  mailbox.onDisconnect = onDisconnect;

  await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(baseline));
  const ws = MockWebSocket.instances[baseline];
  ws.simulateOpen();
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
  ws.simulateMessage(await peerHandshake(sharedSecret));
  await vi.waitFor(() => expect(onConnect).toHaveBeenCalled());

  return { mailbox, ws, onConnect, onDisconnect };
}

describe("Mailbox", () => {
  let sharedSecret: CryptoKey;
  let Mailbox: typeof import("../mailbox").Mailbox;

  beforeEach(async () => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    sharedSecret = await c.generateSharedSecret();

    // Dynamic import to get fresh module state and pick up the WebSocket stub
    vi.resetModules();
    const mod = await import("../mailbox");
    Mailbox = mod.Mailbox;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a WebSocket after DH key generation", async () => {
    new Mailbox("ws://localhost/test", sharedSecret);

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1));
    expect(MockWebSocket.instances.at(-1)!.url).toBe("ws://localhost/test");
  });

  it("sends a DH handshake when WebSocket opens", async () => {
    const baseline = MockWebSocket.instances.length;
    new Mailbox("ws://localhost/test", sharedSecret);

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(baseline));
    const ws = MockWebSocket.instances[baseline];
    ws.simulateOpen();

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("handshake");
    expect(sent.pk).toBeDefined();
    expect(sent.sig).toBeDefined();
  });

  it("calls onConnect after valid peer handshake", async () => {
    const { onConnect } = await establishMailbox(Mailbox, sharedSecret);
    expect(onConnect).toHaveBeenCalled();
  });

  it("sends encrypted messages when ESTABLISHED", async () => {
    const { mailbox, ws } = await establishMailbox(Mailbox, sharedSecret);

    ws.send.mockClear();
    await mailbox.send({ type: "commitment", value: "test" });

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("cryptogram");
    expect(sent.iv).toBeDefined();
    expect(sent.ct).toBeDefined();
  });

  it("rejects send() when not ESTABLISHED", async () => {
    const mailbox = new Mailbox("ws://localhost/test", sharedSecret);
    await expect(mailbox.send({ test: true })).rejects.toBe("Not established");
  });

  it("calls onDisconnect when WebSocket closes from ESTABLISHED", async () => {
    const { ws, onDisconnect } = await establishMailbox(Mailbox, sharedSecret);

    ws.simulateClose();
    expect(onDisconnect).toHaveBeenCalled();
  });

  it("reconnects with 2-second delay after WebSocket close", async () => {
    const baseline = MockWebSocket.instances.length;
    new Mailbox("ws://localhost/test", sharedSecret);

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(baseline));
    const ws1 = MockWebSocket.instances[baseline];
    ws1.simulateOpen();
    await vi.waitFor(() => expect(ws1.send).toHaveBeenCalled());

    const countBefore = MockWebSocket.instances.length;
    ws1.simulateClose();

    // Should not reconnect immediately
    expect(MockWebSocket.instances.length).toBe(countBefore);

    await vi.advanceTimersByTimeAsync(2000);

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it("handles reset message by re-sending handshake", async () => {
    const baseline = MockWebSocket.instances.length;
    new Mailbox("ws://localhost/test", sharedSecret);

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(baseline));
    const ws = MockWebSocket.instances[baseline];
    ws.simulateOpen();
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
    ws.send.mockClear();

    ws.simulateMessage({ type: "reset" });

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("handshake");
  });

  it("transitions to FAIL on invalid signature", async () => {
    const baseline = MockWebSocket.instances.length;
    const mailbox = new Mailbox("ws://localhost/test", sharedSecret);
    const onConnect = vi.fn();
    mailbox.onConnect = onConnect;

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(baseline));
    const ws = MockWebSocket.instances[baseline];
    ws.simulateOpen();
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());

    const peerKp = await c.generateDHKeyPair();
    const pk = await crypto.subtle.exportKey("jwk", peerKp.publicKey);
    ws.simulateMessage({
      type: "handshake",
      pk,
      sig: "00".repeat(16),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(onConnect).not.toHaveBeenCalled();
    await expect(mailbox.send({ test: true })).rejects.toBe("Not established");
  });
});
