// Ensure `self` is defined in Node.js so that `self.crypto` works (used by random16()).
if (typeof self === "undefined") {
  (globalThis as any).self = globalThis;
}
