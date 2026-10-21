export function checkedVariables(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Environment variables must be an object");
  const entries = Object.entries(value),
    names = new Set();
  if (entries.length > 64)
    throw new Error("At most 64 environment variables are supported");
  let size = 0;
  for (const [key, text] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || /^DSH_/i.test(key))
      throw new Error("Invalid or managed environment variable: " + key);
    if (names.has(key.toUpperCase()))
      throw new Error("Environment variable names collide on Windows: " + key);
    if (typeof text !== "string" || text.includes("\0") || text.length > 16384)
      throw new Error("Invalid environment value for " + key);
    names.add(key.toUpperCase());
    size += key.length + text.length;
  }
  if (size > 65536)
    throw new Error("Environment values exceed the supported size");
  return Object.fromEntries(entries);
}

export function mergeVariables(
  selected,
  explicit = {},
  platform = process.platform,
) {
  const entries = new Map();
  for (const [key, value] of [
    ...Object.entries(checkedVariables(selected)),
    ...Object.entries(explicit),
  ]) {
    entries.set(platform === "win32" ? key.toUpperCase() : key, [key, value]);
  }
  return Object.fromEntries(entries.values());
}

export async function environmentOverlay(ctx, sessionId, explicit, signal) {
  signal?.throwIfAborted();
  const service = sessionId && ctx.get("localEnvironments");
  if (!service) return undefined;
  const values = await service.environmentFor(sessionId, signal);
  signal?.throwIfAborted();
  return values === undefined ? undefined : mergeVariables(values, explicit);
}
