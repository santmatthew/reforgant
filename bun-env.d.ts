// Bun's fullstack dev server bundles an HTML entrypoint (and the scripts/styles
// it references) when you import it. Give TS a type for that import.
declare module "*.html" {
  const html: import("bun").HTMLBundle;
  export default html;
}
