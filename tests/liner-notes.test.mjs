import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../plugins/liner-notes/plugin.js", import.meta.url), "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asJson = (value) => JSON.parse(JSON.stringify(value));

function load(request = async () => { throw new Error("unexpected network"); }, { storage = new Map(), locale = "zh-CN" } = {}) {
  const handlers = new Map();
  let registration;
  runInNewContext(script, {
    splayer: {
      locale,
      request,
      register: (args) => { registration = args; },
      on: (action, handler) => handlers.set(action, handler),
      storage: {
        get: async (key) => storage.get(key),
        set: async (key, value) => { storage.set(key, value); },
      },
      log: { warn() {} },
    },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  }, { timeout: 1000 });
  return { handlers, registration, storage };
}

test("registers liner-notes source with musicSearch and musicComment and respects locale", () => {
  const zh = load(undefined, { locale: "zh-CN" });
  assert.equal(zh.registration.sources["liner-notes"].name, "唱片内页");
  assert.deepEqual(asJson(zh.registration.sources["liner-notes"].actions), ["musicSearch", "musicComment"]);

  const en = load(undefined, { locale: "en-US" });
  assert.equal(en.registration.sources["liner-notes"].name, "Liner Notes");
});

test("musicSearch returns host matching fields and forwards the selected release", async () => {
  const { handlers } = load(async (url) => {
    const search = new URL(url);
    assert.equal(search.pathname, "/ws/2/recording/");
    assert.equal(search.searchParams.get("limit"), "100");
    assert.match(search.searchParams.get("query"), /artist:"Beatles"/);
    return {
      status: 200,
      body: { recordings: [{
        id: id(1), title: "Come Together", length: 259000,
        "artist-credit": [null, { name: "The Beatles" }],
        releases: [{ id: id(2), title: "Abbey Road", "release-group": { id: id(3) } }],
      }] },
    };
  });
  const result = await handlers.get("musicSearch")({ source: "liner-notes", keyword: "Come Together The Beatles", limit: 20 });
  assert.deepEqual(asJson(result.list), [{
    id: id(1), name: "Come Together", singer: "The Beatles", album: "Abbey Road",
    releaseId: id(2), releaseIds: [id(2)], releaseGroupId: id(3), durationMs: 259000,
  }]);
});

test("musicComment merges concurrent hot/new requests, fetches Wikipedia + Credits + CAA art, and caches persistently", async () => {
  const calls = [];
  const storage = new Map();
  const request = async (url) => {
    calls.push(url);
    if (url.includes("/ws/2/recording/")) {
      return {
        status: 200,
        body: {
          id: id(1),
          title: "Come Together",
          length: 259000,
          "first-release-date": "1969-09-26",
          "artist-credit": [{ name: "The Beatles" }],
          isrcs: ["GBAYE0601690"],
          tags: [{ name: "rock", count: 12 }, { name: "psychedelic rock", count: 5 }],
          relations: [
            { type: "producer", artist: { name: "George Martin" } },
            { type: "instrument", artist: { name: "Paul McCartney" }, attributes: ["bass guitar"] },
            {
              type: "performance",
              work: {
                id: id(9),
                title: "Come Together",
                languages: ["eng"],
                relations: [
                  { type: "writer", artist: { name: "John Lennon" } },
                  { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q210485" } },
                ],
              },
            },
          ],
          releases: [
            { id: id(2), title: "Abbey Road", status: "Official", country: "GB", date: "1969-09-26", "release-group": { id: id(3), "primary-type": "Album" } },
            { id: id(4), title: "Abbey Road", status: "Official", country: "JP", date: "2019-09-27", disambiguation: "50th Anniversary", "release-group": { id: id(3), "primary-type": "Album" } },
          ],
        },
      };
    }
    if (url.includes("wikidata.org")) {
      return {
        status: 200,
        body: {
          entities: {
            Q210485: {
              sitelinks: {
                zhwiki: { title: "Come Together" },
                enwiki: { title: "Come Together" },
              },
            },
          },
        },
      };
    }
    if (url.includes("zh.wikipedia.org/api/rest_v1/page/summary/")) {
      return {
        status: 200,
        body: {
          type: "standard",
          title: "Come Together",
          description: "披头士乐队1969年歌曲",
          extract: "《Come Together》是英国摇滚乐队披头士收录于专辑《Abbey Road》的开场曲。",
          thumbnail: { source: "https://upload.wikimedia.org/wikipedia/en/thumb/example.jpg" },
          content_urls: { desktop: { page: "https://zh.wikipedia.org/wiki/Come_Together" } },
        },
      };
    }
    if (url.includes("coverartarchive.org/release/")) {
      return {
        status: 200,
        body: {
          images: [
            { front: true, types: ["Front"], thumbnails: { "500": "https://archive.org/front.jpg" } },
            { front: false, types: ["Back"], thumbnails: { "500": "http://archive.org/back.jpg" } },
            { front: false, types: ["Medium"], thumbnails: { "500": "https://archive.org/disc.jpg" } },
          ],
        },
      };
    }
    return { status: 404, body: {} };
  };

  const first = load(request, { storage, locale: "zh-CN" });
  const musicInfo = { id: id(1), name: "Come Together", singer: "The Beatles", album: "Abbey Road", releaseId: id(2), releaseGroupId: id(3), durationMs: 259000 };
  const comment = first.handlers.get("musicComment");

  // Simulate Atom frontend firing hot and new in parallel.
  const [hotRes, newRes] = await Promise.all([
    comment({ source: "liner-notes", musicInfo, type: "hot", page: 1, limit: 20 }),
    comment({ source: "liner-notes", musicInfo, type: "new", page: 1, limit: 20 }),
  ]);

  // Only 4 upstream calls total (recording + wikidata + zh.wiki + CAA), proving hot/new deduplication.
  assert.equal(calls.length, 4);
  assert.equal(hotRes.total, 4);
  assert.match(hotRes.list[0].userName, /维基百科/);
  assert.match(hotRes.list[0].text, /Abbey Road/);
  assert.equal(hotRes.list[0].reply[0].text, "https://zh.wikipedia.org/wiki/Come_Together");
  assert.match(hotRes.list[1].text, /GBAYE0601690/);
  assert.match(hotRes.list[2].text, /George Martin/);
  assert.match(hotRes.list[2].text, /Paul McCartney \(bass guitar\)/);
  assert.deepEqual(asJson(hotRes.list[3].images), ["https://archive.org/back.jpg", "https://archive.org/disc.jpg"]);

  assert.equal(newRes.total, 2);
  assert.match(newRes.list[0].text, /50th Anniversary/);
  assert.match(newRes.list[1].userName, /\[初版\]/);

  // Reload plugin and verify persistent cache avoids network calls.
  await new Promise((resolve) => setImmediate(resolve));
  const second = load(request, { storage, locale: "zh-CN" });
  const cachedHot = await second.handlers.get("musicComment")({ source: "liner-notes", musicInfo, type: "hot" });
  assert.equal(cachedHot.total, 4);
  assert.equal(calls.length, 4);
});

test("falls back to album release-group Wikipedia when song has no wiki link", async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.includes("/ws/2/recording/")) {
      return {
        status: 200,
        body: {
          id: id(10),
          title: "Deep Cut",
          length: 200000,
          "artist-credit": [{ name: "Artist" }],
          relations: [{ type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/%E0%A4%A" } }],
          releases: [{ id: id(11), title: "Great Album", status: "Official", date: "1995-05-01", "release-group": { id: id(12) } }],
        },
      };
    }
    if (url.includes("/ws/2/release-group/")) {
      return {
        status: 200,
        body: {
          id: id(12),
          relations: [{ type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Great_Album#Reception" } }],
        },
      };
    }
    if (url === "https://en.wikipedia.org/api/rest_v1/page/summary/Great_Album") {
      return {
        status: 200,
        body: {
          type: "standard",
          title: "Great Album",
          extract: "Great Album is a landmark 1995 studio album.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Great_Album" } },
        },
      };
    }
    return { status: 404, body: {} };
  };

  const { handlers } = load(request, { locale: "zh-CN" });
  const res = await handlers.get("musicComment")({
    source: "liner-notes",
    musicInfo: { id: id(10), name: "Deep Cut", album: "Great Album", releaseId: id(11), releaseGroupId: id(12) },
    type: "hot",
  });
  assert.match(res.list[0].userName, /专辑背景/);
  assert.match(res.list[0].text, /landmark 1995/);
  assert(calls.some((u) => u.includes("/ws/2/release-group/")));
});

test("persistent notes cache keeps Chinese and English cards separate", async () => {
  const storage = new Map();
  let requests = 0;
  const request = async () => {
    requests++;
    return { status: 200, body: { id: id(20), title: "Song" } };
  };
  const query = { source: "liner-notes", musicInfo: { id: id(20) } };
  const comment = (locale) => load(request, { storage, locale }).handlers.get("musicComment")(query);
  const chinese = await comment("zh-CN");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(chinese.list[0].userName, /唱片档案/);
  const english = await comment("en-US");
  assert.match(english.list[0].userName, /Release Profile/);
  assert.equal(requests, 2);
});
