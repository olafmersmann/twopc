import * as c from "./crypto";
import { assert, assertDefined } from "./assert";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

enum State {
  START,
  KEYED,
  CONNECTED,
  GOT_HANDSHAKE,
  ESTABLISHED,
  ERROR,
  RECONNECT,
  FAIL,
}

enum Event {
  KeyGenerated, // DH keypair generated
  KeyGenerationFailed, // DH keypair generation failed (not sure how this could happen...)
  WsOpen, // WebSocket.onOpen event
  WsClose, // WebSocket close and error events
  HandshakeRecieved, // recieved a DH handshake from peer
  SessionEstablished, // DH handshake validated, sessions secret derived
  VerificationFailed, // DH verification failed
  WsReset, // Sent by server when other side disconnects
}

interface Transition {
  from: State;
  event: Event;
  to: State;
}

const transitions: Transition[] = [
  { from: State.START, event: Event.KeyGenerated, to: State.KEYED },
  { from: State.START, event: Event.KeyGenerationFailed, to: State.FAIL },
  { from: State.KEYED, event: Event.WsOpen, to: State.CONNECTED },
  { from: State.KEYED, event: Event.WsClose, to: State.KEYED },
  { from: State.CONNECTED, event: Event.HandshakeRecieved, to: State.GOT_HANDSHAKE },
  { from: State.CONNECTED, event: Event.WsReset, to: State.CONNECTED },
  { from: State.CONNECTED, event: Event.WsClose, to: State.RECONNECT },
  { from: State.GOT_HANDSHAKE, event: Event.SessionEstablished, to: State.ESTABLISHED },
  { from: State.GOT_HANDSHAKE, event: Event.VerificationFailed, to: State.FAIL },
  { from: State.GOT_HANDSHAKE, event: Event.WsReset, to: State.CONNECTED },
  { from: State.GOT_HANDSHAKE, event: Event.WsClose, to: State.RECONNECT },
  { from: State.ESTABLISHED, event: Event.WsReset, to: State.CONNECTED },
  { from: State.ESTABLISHED, event: Event.HandshakeRecieved, to: State.GOT_HANDSHAKE }, // Rekeying
  { from: State.ESTABLISHED, event: Event.WsClose, to: State.RECONNECT },
  { from: State.RECONNECT, event: Event.WsOpen, to: State.CONNECTED },
  { from: State.RECONNECT, event: Event.WsReset, to: State.RECONNECT },
  { from: State.RECONNECT, event: Event.WsClose, to: State.RECONNECT },
];

export class Mailbox {
  private state: State | null = State.START;
  private ws: WebSocket | null = null;
  private url: string;
  private sharedSecret: CryptoKey;
  private dhKeyPair: CryptoKeyPair | null = null;
  private sessionKey: CryptoKey | null = null;
  private peerKey: JsonWebKey | null = null;
  private peerSig: string | null = null;

  constructor(url: string, sharedSecret: CryptoKey) {
    this.url = url;
    this.sharedSecret = sharedSecret;
    this.enterState();
  }

  public async send(message: object): Promise<void> {
    if (this.state !== State.ESTABLISHED) return Promise.reject("Not established");

    return c.encryptMessage(this.sessionKey!, message).then((msg) => this.ws!.send(JSON.stringify(msg)));
  }

  public close() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
  }

  onMessage: (msg: object) => void = () => {};
  onConnect: () => void = () => {};
  onDisconnect: () => void = () => {};

  private dispatch(event: Event) {
    if (this.state === null) return;

    const next = transitions.find((t) => t.from === this.state && t.event === event) ?? {
      from: this.state,
      event: event,
      to: State.ERROR,
    };

    console.debug(`Mailbox FSM: ${State[next.from]} -[${Event[next.event]}]-> ${State[next.to]} `);
    this.leaveState();
    this.state = next.to;
    this.enterState();
  }

  private async enterState(): Promise<void> {
    switch (this.state) {
      case State.START:
        c.generateDHKeyPair()
          .then((keypair) => (this.dhKeyPair = keypair))
          .then(() => this.dispatch(Event.KeyGenerated));
        break;
      case State.KEYED:
        this.openWebSocket();
        break;
      case State.CONNECTED:
        this.sendHanshake();
        break;
      case State.GOT_HANDSHAKE:
        this.deriveSessionKey();
        break;
      case State.ESTABLISHED:
        this.onConnect();
        break;
      case State.ERROR:
        break;
      case State.RECONNECT:
        const ws = this.ws;
        this.ws = null;
        if (ws) {
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.close();
          }
        }
        // Wait for two seconds, then reconnect.
        setTimeout(() => this.openWebSocket(), 2000);
        break;
    }
  }

  private async leaveState(): Promise<void> {
    if (this.state === State.ESTABLISHED) {
      this.onDisconnect();
    }
  }

  private openWebSocket(): void {
    this.ws?.close();
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => this.dispatch(Event.WsOpen);
    this.ws.onclose = () => this.dispatch(Event.WsClose);
    // FIXME: Should probably log / display error
    this.ws.onerror = () => this.dispatch(Event.WsClose);

    this.ws.onmessage = async (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type == "reset") {
          this.dispatch(Event.WsReset);
        } else if (msg.type == "handshake") {
          this.peerKey = msg.pk;
          this.peerSig = msg.sig;
          this.dispatch(Event.HandshakeRecieved);
        } else if (msg.type == "cryptogram") {
          if (this.state === State.ESTABLISHED) {
            c.decryptMessage(this.sessionKey!, msg).then((pt) => this.onMessage(pt));
          } else {
            console.warn(`Mailbox: Got cryptogram in state ${this.state}`);
          }
        } else {
          console.warn(`Mailbox: Unknown message type "${msg.type}". Ignoring.`);
        }
      } catch (e) {
        console.warn("Mailbox: Failed to parse message:", e, ev.data);
      }
    };
  }

  private async sendHanshake(): Promise<void> {
    assertDefined(this.dhKeyPair, "Missing DH keypair");
    const msg = {
      type: "handshake",
      pk: await crypto.subtle.exportKey("jwk", this.dhKeyPair!.publicKey),
      sig: await c.signPk(this.sharedSecret, this.dhKeyPair!.publicKey),
    };
    if (this.ws) {
      this.ws!.send(JSON.stringify(msg));
    } else {
      console.error(`Mailbox: websocket is null.`);
    }
  }

  private async deriveSessionKey(): Promise<void> {
    assertDefined(this.peerKey, "Missing peers public key");
    assertDefined(this.peerSig, "Missing peers signature of public key");
    const pk = await c.importPk(this.peerKey!);
    const isOk = await c.verifyPk(this.sharedSecret, this.peerSig!, pk);

    if (isOk) {
      this.sessionKey = await c.deriveSharedKey(pk, this.dhKeyPair!.privateKey);
      this.dispatch(Event.SessionEstablished);
    } else {
      this.dispatch(Event.VerificationFailed);
    }
  }
}
