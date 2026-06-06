/**
 * Bun fullstack host (§3). Importing the HTML entrypoint makes Bun bundle the
 * client (main.ts and everything it imports, including ../diagnostic.ts) and its
 * stylesheet. No backend logic, no server-side compute — static serving only.
 *
 *   bun run server.ts      # serve
 *   bun --hot run server.ts  # serve with hot reload (dev)
 */

import index from "./web/index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: true,
  routes: {
    "/": index,
    "/*": index,
  },
});

console.log(`Reforgant — skills diagnostic → ${server.url}`);
