const DATASTORES = new Set([
  "postgresql",
  "postgres",
  "redis",
  "rabbitmq",
  "mysql",
  "mongodb",
  "kafka",
  "memcached",
  "elasticsearch",
  "amqp",
]);

export function isDatastore(nodeId: string): boolean {
  const id = nodeId.toLowerCase();
  if (DATASTORES.has(id)) return true;
  // match compound names like "orders-postgresql" or "cache:redis"
  for (const ds of DATASTORES) {
    if (id.includes(ds)) return true;
  }
  return false;
}

/** Format a micros value as human-readable ms / s. */
export function formatMicros(micros: number): string {
  if (micros < 1000) return `${Math.round(micros)}µs`;
  const ms = micros / 1000;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)}s`;
}

/** Deterministic 32-bit hash of a string. */
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
