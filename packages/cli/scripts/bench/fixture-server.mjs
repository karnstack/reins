// Serves ./fixtures on 127.0.0.1 and prints one JSON line `{ "port": n }`.
//
//   node packages/cli/scripts/bench/fixture-server.mjs [port]   (0 / omitted = random)
//
// bench-do.mjs runs this as a child process. It must not live inside the
// runner: the runner drives reins with synchronous child calls, and
// `reins open` waits for the page to load — a server on the runner's own
// event loop could never answer that request.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname.replace(/^\/+/, "");
  const file = resolve(FIXTURES, path || "index.html");
  if (!file.startsWith(FIXTURES) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
});

server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
