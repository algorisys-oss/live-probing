// Export helpers for the SVG diagrams. The on-screen SVG is styled by CSS classes, so to make
// a standalone file we clone it and inline the computed styles, then serialize / rasterize.

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
];

function inlineStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  let style = "";
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) style += `${p}:${v};`;
  }
  dst.setAttribute("style", style);
  const s = src.children;
  const d = dst.children;
  for (let i = 0; i < s.length && i < d.length; i++) inlineStyles(s[i]!, d[i]!);
}

function viewBoxDims(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) return { w: parts[2]!, h: parts[3]! };
  }
  const r = svg.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function currentBg(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return v || "#0d1117";
}

function standaloneSvg(svg: SVGSVGElement, bg = currentBg()): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const { w, h } = viewBoxDims(svg);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  // background rect (first child), positioned at the viewBox origin
  const vb = (svg.getAttribute("viewBox") ?? "0 0 " + w + " " + h).split(/\s+/).map(Number);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(vb[0] ?? 0));
  rect.setAttribute("y", String(vb[1] ?? 0));
  rect.setAttribute("width", String(vb[2] ?? w));
  rect.setAttribute("height", String(vb[3] ?? h));
  rect.setAttribute("fill", bg);
  clone.insertBefore(rect, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  download(new Blob([standaloneSvg(svg)], { type: "image/svg+xml" }), filename);
}

export function downloadPng(svg: SVGSVGElement, filename: string, scale = 2): void {
  const { w, h } = viewBoxDims(svg);
  const xml = standaloneSvg(svg);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && download(blob, filename), "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
}
