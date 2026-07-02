import type { Sequence } from "../sequence.js";
import type { Topology } from "../trace-window.js";

// Mermaid needs alphanumeric node ids; keep a readable alias for the label.
function nodeId(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "_");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `n_${cleaned}`;
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ");
}

export function toMermaidSequence(seq: Sequence): string {
  const lines = ["sequenceDiagram"];
  for (const p of seq.participants) {
    lines.push(`  participant ${nodeId(p)} as ${escapeLabel(p)}`);
  }
  for (const m of seq.messages) {
    const arrow = m.async ? "-)" : "->>";
    lines.push(`  ${nodeId(m.from)}${arrow}${nodeId(m.to)}: ${escapeLabel(m.label)}`);
  }
  return lines.join("\n");
}

export function toMermaidFlow(topo: Topology): string {
  const lines = ["graph LR"];
  for (const n of topo.nodes) {
    lines.push(`  ${nodeId(n)}["${escapeLabel(n)}"]`);
  }
  for (const e of topo.edges) {
    const label = e.errors > 0 ? `${e.calls} (${e.errors} err)` : `${e.calls}`;
    lines.push(`  ${nodeId(e.from)} -->|${label}| ${nodeId(e.to)}`);
  }
  // Uninstrumented ("ghost") peers render dashed.
  if (topo.externals.length > 0) {
    lines.push("  classDef external stroke-dasharray: 6 4,opacity:0.75");
    for (const ext of topo.externals) {
      lines.push(`  class ${nodeId(ext)} external`);
    }
  }
  return lines.join("\n");
}
