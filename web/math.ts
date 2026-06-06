/**
 * Render LaTeX via KaTeX (loaded from CDN in index.html). Returns HTML, or null
 * if KaTeX isn't available (offline / not yet loaded) so callers fall back to
 * the plain-text label.
 */

declare global {
  interface Window {
    katex?: { renderToString(tex: string, opts?: Record<string, unknown>): string };
  }
}

export function mathToHtml(latex: string, display = false): string | null {
  const k = typeof window !== "undefined" ? window.katex : undefined;
  if (!k) return null;
  try {
    return k.renderToString(latex, { throwOnError: false, displayMode: display, output: "html" });
  } catch {
    return null;
  }
}
