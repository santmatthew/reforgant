/** Tiny DOM helper — no framework. `h("div", { class: "x" }, ...children)`. */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k === "value") (el as HTMLInputElement).value = String(v);
    else if (k === "checked" || k === "disabled") (el as HTMLInputElement & Record<string, unknown>)[k] = Boolean(v);
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) append(el, c);
  return el;
}

export function append(el: HTMLElement, c: Child): void {
  if (c == null || c === false) return;
  el.append(c instanceof Node ? c : document.createTextNode(String(c)));
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Split text on `backtick` spans → text + <code class="inline-code"> nodes. */
export function inlineCode(text: string): (HTMLElement | string)[] {
  const out: (HTMLElement | string)[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h("code", { class: "inline-code" }, m[1]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function round(x: number, dp = 1): string {
  const m = 10 ** dp;
  return String(Math.round(x * m) / m);
}
