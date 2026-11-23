import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["/musicbrainz-cover.js", new URL("../plugins/musicbrainz-cover/plugin.js", import.meta.url)],
  ["/music-tools.js", new URL("../plugins/music-tools/plugin.js", import.meta.url)],
]);
const port = Number(process.env.PORT || 8765);
const server = createServer(async (request, response) => {
  const file = files.get(request.url?.split("?")[0]);
  if (request.method !== "GET" || !file) { response.writeHead(404).end(); return; }
  try {
    const script = await readFile(file);
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    response.end(script);
  } catch { response.writeHead(500).end(); }
});
server.listen(port, "127.0.0.1", () => console.log(`Plugin scripts: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
