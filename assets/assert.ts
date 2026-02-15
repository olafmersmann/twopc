export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error("Assertion failed.");
    throw new Error(message);
  }
}

export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    console.error("Assertion failed.");
    throw new Error(message);
  }
}
