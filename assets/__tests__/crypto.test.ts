import { describe, it, expect } from "vitest";
import { toHex } from "../utils";
import {
  encryptMessage,
  decryptMessage,
  generateDHKeyPair,
  importPk,
  signPk,
  verifyPk,
  deriveSharedKey,
  generateSharedSecret,
  encodeUrlSecret,
  decodeUrlSecret,
  calculateCommitment,
} from "../crypto";

describe("encryptMessage / decryptMessage", () => {
  it("round-trips a JSON object", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();
    const key = await deriveSharedKey(kp2.publicKey, kp1.privateKey);

    const original = { type: "commitment", value: "hello world" };
    const encrypted = await encryptMessage(key, original);

    expect(encrypted.type).toBe("cryptogram");
    expect(encrypted.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(encrypted.ct).toBeTruthy();

    const key2 = await deriveSharedKey(kp1.publicKey, kp2.privateKey);
    const decrypted = await decryptMessage(key2, encrypted);
    expect(decrypted).toEqual(original);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();
    const key = await deriveSharedKey(kp2.publicKey, kp1.privateKey);

    const msg = { data: "same" };
    const enc1 = await encryptMessage(key, msg);
    const enc2 = await encryptMessage(key, msg);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ct).not.toBe(enc2.ct);
  });

  it("fails to decrypt with wrong key", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();
    const key = await deriveSharedKey(kp2.publicKey, kp1.privateKey);
    const badIv = crypto.getRandomValues(new Uint8Array(12));

    const enc = await encryptMessage(key, { secret: true });
    enc.iv = toHex(badIv.buffer);
    await expect(decryptMessage(key, enc)).rejects.toThrow();
  });

  it("fails to decrypt with wrong iv", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();
    const kp3 = await generateDHKeyPair();
    const rightKey = await deriveSharedKey(kp2.publicKey, kp1.privateKey);
    const wrongKey = await deriveSharedKey(kp3.publicKey, kp1.privateKey);

    const msg = { secret: true };
    const encrypted = await encryptMessage(rightKey, msg);
    await expect(decryptMessage(wrongKey, encrypted)).rejects.toThrow();
  });
});

describe("generateDHKeyPair", () => {
  it("generates a key pair with public and private keys", async () => {
    const kp = await generateDHKeyPair();
    expect(kp.publicKey.type).toBe("public");
    expect(kp.privateKey.type).toBe("private");
  });

  it("generates different key pairs each time", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();
    const raw1 = new Uint8Array(await crypto.subtle.exportKey("raw", kp1.publicKey));
    const raw2 = new Uint8Array(await crypto.subtle.exportKey("raw", kp2.publicKey));
    expect(raw1).not.toEqual(raw2);
  });
});

describe("importPk", () => {
  it("re-imports an exported JWK with matching raw bytes", async () => {
    const kp = await generateDHKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const imported = await importPk(jwk);

    const rawOriginal = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const rawImported = new Uint8Array(await crypto.subtle.exportKey("raw", imported));
    expect(rawImported).toEqual(rawOriginal);
  });
});

describe("signPk / verifyPk", () => {
  it("produces a valid signature", async () => {
    const hmacKey = await generateSharedSecret();
    const kp = await generateDHKeyPair();

    const sig = await signPk(hmacKey, kp.publicKey);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(await verifyPk(hmacKey, sig, kp.publicKey)).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const hmacKey = await generateSharedSecret();
    const kp = await generateDHKeyPair();
    const sig = await signPk(hmacKey, kp.publicKey);

    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await verifyPk(hmacKey, tampered, kp.publicKey)).toBe(false);
  });

  it("rejects signature from different HMAC key", async () => {
    const hmacKey1 = await generateSharedSecret();
    const hmacKey2 = await generateSharedSecret();
    const kp = await generateDHKeyPair();

    const sig = await signPk(hmacKey1, kp.publicKey);
    expect(await verifyPk(hmacKey2, sig, kp.publicKey)).toBe(false);
  });

  it("rejects signature for different public key", async () => {
    const hmacKey = await generateSharedSecret();
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();

    const sig = await signPk(hmacKey, kp1.publicKey);
    expect(await verifyPk(hmacKey, sig, kp2.publicKey)).toBe(false);
  });
});

describe("deriveSharedKey", () => {
  it("derives equivalent keys from both sides of DH exchange", async () => {
    const kp1 = await generateDHKeyPair();
    const kp2 = await generateDHKeyPair();

    const key1 = await deriveSharedKey(kp2.publicKey, kp1.privateKey);
    const key2 = await deriveSharedKey(kp1.publicKey, kp2.privateKey);

    const msg = { test: "symmetric" };
    const encrypted = await encryptMessage(key1, msg);
    const decrypted = await decryptMessage(key2, encrypted);
    expect(decrypted).toEqual(msg);
  });
});

describe("generateSharedSecret", () => {
  it("generates an HMAC key for sign and verify", async () => {
    const key = await generateSharedSecret();
    expect(key.type).toBe("secret");
    expect(key.usages).toContain("sign");
    expect(key.usages).toContain("verify");
  });
});

describe("encodeUrlSecret / decodeUrlSecret", () => {
  it("round-trips a shared secret", async () => {
    const original = await generateSharedSecret();
    const encoded = await encodeUrlSecret(original);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = await decodeUrlSecret(encoded);

    // Verify functional equivalence: same HMAC signatures
    const kp = await generateDHKeyPair();
    const sig1 = await signPk(original, kp.publicKey);
    const sig2 = await signPk(decoded, kp.publicKey);
    expect(sig1).toBe(sig2);
  });
});

describe("calculateCommitment", () => {
  it("produces a deterministic 64-char hex hash", async () => {
    const c1 = await calculateCommitment("hello", "abc123");
    const c2 = await calculateCommitment("hello", "abc123");
    expect(c1).toBe(c2);
    expect(c1).toHaveLength(64);
    expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different messages produce different hashes", async () => {
    const c1 = await calculateCommitment("hello", "abc123");
    const c2 = await calculateCommitment("world", "abc123");
    expect(c1).not.toBe(c2);
  });

  it("different randoms produce different hashes", async () => {
    const c1 = await calculateCommitment("hello", "abc123");
    const c2 = await calculateCommitment("hello", "def456");
    expect(c1).not.toBe(c2);
  });

  it("handles empty message", async () => {
    const c = await calculateCommitment("", "random");
    expect(c).toHaveLength(64);
  });
});
