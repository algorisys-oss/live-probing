import { coerceEvents, type Event } from "@liveprobe/core";
import { adapterId1 } from "./adapter-id-1.js";
import { algoInstrumentation } from "./algo-instrumentation.js";

// An adapter maps one raw source payload into normalized events (the narrow waist).
export type Adapter = (raw: unknown) => Event[];

export const adapters: Record<string, Adapter> = {
  "adapter-id-1": adapterId1,
  "algo-instrumentation": algoInstrumentation,
  // Passthrough for sources that already emit normalized LiveProbe events.
  "liveprobe-native": (raw) => coerceEvents(Array.isArray(raw) ? raw : [raw]),
};

export function getAdapter(name: string): Adapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`unknown adapter "${name}" (have: ${Object.keys(adapters).join(", ")})`);
  }
  return adapter;
}
