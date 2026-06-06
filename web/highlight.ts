/**
 * Tiny dependency-free syntax highlighter for the demo's code snippets (Python /
 * JavaScript). Returns HTML with `.tok-*` spans (themed in styles.css). Input is
 * our own battery content, and every segment is HTML-escaped, so it's safe.
 */

const KEYWORDS: Record<string, Set<string>> = {
  python: new Set(
    "def return for in if elif else while class import from as with lambda yield not and or is None True False try except finally raise pass break continue global nonlocal assert del print len range".split(" "),
  ),
  javascript: new Set(
    "const let var function return for of in if else while do class new import from export default try catch finally throw typeof instanceof void delete await async yield null undefined true false this super break continue switch case console".split(" "),
  ),
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(code: string, lang: string): string {
  const kw = KEYWORDS[lang] ?? new Set<string>();
  // comment | string | number | identifier — tried left-to-right at each position
  const re = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-num">${esc(m[3])}</span>`;
    else if (m[4]) {
      const w = m[4];
      if (kw.has(w)) out += `<span class="tok-kw">${esc(w)}</span>`;
      else if (code[re.lastIndex] === "(") out += `<span class="tok-fn">${esc(w)}</span>`;
      else out += esc(w);
    }
  }
  out += esc(code.slice(last));
  return out;
}
