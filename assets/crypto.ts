import { fromHex, toHex } from "./utils.js";

export interface Cryptogram {
  type: string;
  iv: string;
  ct: string;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export async function encryptMessage(key: CryptoKey, msg: object): Promise<Cryptogram> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits of IV
  const pt = ENCODER.encode(JSON.stringify(msg));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);

  return { type: "cryptogram", iv: toHex(iv.buffer), ct: toHex(ct) };
}

export async function decryptMessage(key: CryptoKey, msg: Cryptogram): Promise<object> {
  const iv = fromHex(msg.iv);
  const ct = fromHex(msg.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);

  return JSON.parse(DECODER.decode(pt));
}

const DH_ALGO = { name: "X25519" };

export function generateDHKeyPair(): Promise<CryptoKeyPair> {
  const res = crypto.subtle.generateKey(DH_ALGO, true, ["deriveKey"]);
  return res as Promise<CryptoKeyPair>;
}

export async function importPk(key: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey("jwk", key, DH_ALGO, true, []);
}

export async function signPk(key: CryptoKey, pk: CryptoKey): Promise<string> {
  const msg = await crypto.subtle.exportKey("raw", pk);
  const sig = await crypto.subtle.sign("HMAC", key, msg);

  return toHex(sig);
}

export async function verifyPk(key: CryptoKey, sig: string, pk: CryptoKey): Promise<boolean> {
  return crypto.subtle.exportKey("raw", pk).then((msg) => crypto.subtle.verify("HMAC", key, fromHex(sig), msg));
}

export function deriveSharedKey(pk: CryptoKey, sk: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "X25519",
      public: pk,
    },
    sk,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

const SIGN_ALGO = {
  name: "HMAC",
  hash: "SHA-256",
  length: 128,
};

export function generateSharedSecret(): Promise<CryptoKey> {
  const res = crypto.subtle.generateKey(SIGN_ALGO, true, ["sign", "verify"]);
  return res as Promise<CryptoKey>;
}

export async function encodeUrlSecret(key: CryptoKey): Promise<string> {
  const bytes = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export async function decodeUrlSecret(str: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("raw", bytes, SIGN_ALGO, true, ["sign", "verify"]);
}

export async function calculateCommitment(message: string, random: string): Promise<string> {
  const bytes = ENCODER.encode([message, random].join("\n"));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(hash);
}
