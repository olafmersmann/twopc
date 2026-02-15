export function toHex(raw: ArrayBuffer): string {
  const bytes = new Uint8Array(raw);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const HKDF_ALGO = {
  name: "HKDF",
  hash: "SHA-256",
  salt: new Uint8Array(32),
  info: new Uint8Array(0),
};

export async function mailboxId(sharedSecret: CryptoKey): Promise<string> {
  const bytes = await crypto.subtle.exportKey("raw", sharedSecret);
  const key = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveBits"]);
  const random = await crypto.subtle.deriveBits(HKDF_ALGO, key, 256);

  return toHex(random);
}

export function random16(): string {
  const arr = new Uint8Array(16);
  self.crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

export function $<T extends Element = HTMLElement>(
  selector: string,
  type?: new (...args: any[]) => T,
  root: Element | Document = document,
): T {
  const el = root.querySelector(selector);
  if (!el) {
    throw new Error(`No element found for selector: ${selector}`);
  }
  if (type && !(el instanceof type)) {
    throw new Error(`Element ${selector} is not a ${type.name}`);
  }
  return el as T;
}
