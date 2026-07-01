import { createInterface } from "node:readline";

// Read newline-delimited JSON from stdin. Each line is one raw source event.
export function stdinSource(onEvent: (raw: unknown) => void, onClose: () => void): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  });
  rl.on("close", onClose);
}
