// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { toHex, fromHex, mailboxId, random16, $ } from "../utils";

describe("toHex / fromHex round-trip", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const hex = toHex(original.buffer);
    const result = fromHex(hex);
    expect(result).toEqual(original);
  });
});

describe("mailboxId", () => {
  it("produces a deterministic 64-char hex string", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 128 }, true, [
      "sign",
      "verify",
    ]);
    const id1 = await mailboxId(key);
    const id2 = await mailboxId(key);

    expect(id1).toHaveLength(64);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different keys", async () => {
    const key1 = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 128 }, true, [
      "sign",
      "verify",
    ]);
    const key2 = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 128 }, true, [
      "sign",
      "verify",
    ]);
    expect(await mailboxId(key1)).not.toBe(await mailboxId(key2));
  });
});

describe("random16", () => {
  it("returns a 32-char hex string", () => {
    const r = random16();
    expect(r).toHaveLength(32);
    expect(r).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns different values on successive calls", () => {
    expect(random16()).not.toBe(random16());
  });
});
