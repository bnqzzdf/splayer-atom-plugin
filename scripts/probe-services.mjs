// Diagnose public MusicBrainz/CAA connectivity independently of Core's matcher.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const handlers = new Map();
const source = await readFile(process.argv[2] || new URL("../plugins/musicbrainz-cover/plugin.js", import.meta.url), "utf8");
runInNewContext(source, {
  URL, URLSearchParams, setTimeout, clearTimeout,
  splayer: {
    register() {}, on: (name, handler) => handlers.set(name, handler),
    log: { warn: console.warn },
    storage: { get: async () => null, set: async () => {} },
    request: async (url, options) => {
      const start = Date.now();
      try {
        const response = await fetch(url, { headers: options.headers, signal: AbortSignal.timeout(options.timeout) });
        const body = await response.json().catch(() => null);
        console.log(JSON.stringify({ url, status: response.status, elapsedMs: Date.now() - start }));
        return { status: response.status, body };
      } catch (error) {
        console.log(JSON.stringify({ url, error: error.message, cause: error.cause?.message, elapsedMs: Date.now() - start }));
        throw error;
      }
    },
  },
});
const search = await handlers.get("musicSearch")({ source: "musicbrainz", keyword: "Come Together The Beatles" });
console.log(JSON.stringify({ count: search.list.length, candidates: search.list.filter((candidate) => candidate.album === "Abbey Road") }));
const match = search.list.find((candidate) => candidate.album === "Abbey Road" && Math.abs(candidate.durationMs - 259000) < 20000);
if (match) console.log(JSON.stringify(await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: match })));
