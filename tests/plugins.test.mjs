import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const scripts = Object.fromEntries(await Promise.all(["music-tools", "musicbrainz-cover"].map(async (name) =>
  [name, await readFile(new URL(`../plugins/${name}/plugin.js`, import.meta.url), "utf8")])));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recording = (overrides = {}) => ({ id: id(1), title: "Come Together", length: 259000,
  "artist-credit": [{ name: "The Beatles" }], releases: [
    { id: id(2), title: "Abbey Road", status: "Official", "release-group": { id: id(3), "primary-type": "Album" } },
    { id: id(4), title: "Abbey Road", status: "Official", "release-group": { id: id(3), "primary-type": "Album" } },
    { id: id(5), title: "Greatest Hits", status: "Official", "release-group": { id: id(6), "secondary-types": ["Compilation"] } },
  ], ...overrides });
const imageUrl = "https://archive.org/download/mbid-example/front-1200.jpg";
const front = { front: true, thumbnails: { "1200": imageUrl } };
function load(name, request = async () => { throw new Error("unexpected network"); }, { storage = new Map(), locale = "zh-CN" } = {}) {
  const handlers = new Map();
  let registration;
  runInNewContext(scripts[name], { splayer: {
    locale, request, register: (args) => { registration = args; }, on: (action, handler) => handlers.set(action, handler),
    storage: { get: async (key) => storage.get(key), set: async (key, value) => { storage.set(key, value); } },
    log: { warn() {} },
  }, URL, URLSearchParams, setTimeout, clearTimeout }, { timeout: 1000 });
  return { handlers, registration, storage };
}
const asJson = (value) => JSON.parse(JSON.stringify(value));

test("Music Tools uses only UI permission and five menus; handles multiple artists and unicode", async () => {
  const { handlers, registration } = load("music-tools");
  assert.equal(registration.menus.length, 5);
  assert.equal(registration.controls, undefined);
  assert.match(scripts["music-tools"], /@grant\s+ui\s*\n/);
  const action = handlers.get("menuClick");
  const track = { title: '曲名 & "夜" / A+B', artists: [{ name: "艺术家" }, { name: "Björk" }, { name: "艺术家" }], album: { name: "专辑" } };
  assert.equal((await action({ menuId: "copy-track", track })).copyText, '艺术家 / Björk - 曲名 & "夜" / A+B');
  assert.equal((await action({ menuId: "copy-album", track })).copyText, "艺术家 / Björk - 专辑");
  for (const menuId of ["discogs", "youtube"]) {
    const url = new URL((await action({ menuId, track })).openUrl);
    assert.equal(url.searchParams.get(menuId === "discogs" ? "q" : "search_query"), `艺术家 / Björk ${track.title}`);
  }
  const mb = new URL((await action({ menuId: "musicbrainz", track })).openUrl);
  assert.equal(mb.searchParams.get("type"), "recording");
  assert.match(mb.searchParams.get("query"), /\\"夜\\"/);
  assert.match(mb.searchParams.get("query"), /artistname:"艺术家" AND artistname:"Björk"/);
  assert.deepEqual(asJson(await action({ menuId: "unknown", track })), {});
  assert.equal((await action({ menuId: "copy-album", track: {} })).copyText, undefined);
  assert.equal((await action({ menuId: "copy-track", track: {} })).copyText, undefined);
  assert.equal((await action({ menuId: "copy-track", track: { title: "Song" } })).copyText, "Song");
});

test("English menu text follows host locale", () => {
  const { registration } = load("music-tools", undefined, { locale: "en-US" });
  assert.equal(registration.menus[0].label, "Search on MusicBrainz");
});

test("search preserves album variants, duration, credits; safely quotes keyword; deduplicates requests", async () => {
  const calls = [];
  const { handlers, registration } = load("musicbrainz-cover", async (url, options) => {
    calls.push({ url, options });
    return { status: 200, body: { recordings: [recording(), recording({ id: id(9), length: undefined })] } };
  });
  assert.deepEqual(asJson(registration.sources.musicbrainz.actions), ["musicSearch", "musicPic"]);
  const search = handlers.get("musicSearch");
  const req = { source: "musicbrainz", keyword: 'Come Together The Beatles + OR reid:*' };
  const [a, b] = await Promise.all([search(req), search(req)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(asJson(a), asJson(b));
  assert.equal(a.list.length, 2);
  assert.equal(a.list[0].album, "Abbey Road");
  assert.equal(a.list[0].durationMs, 259000);
  assert.equal(a.list[0].singer, "The Beatles");
  assert.deepEqual(asJson(a.list[0].releaseIds), [id(2), id(4)]);
  assert.equal(a.list[1].album, "Greatest Hits");
  assert.match(new URL(calls[0].url).searchParams.get("query"), /artist:"Beatles"/);
  assert.doesNotMatch(new URL(calls[0].url).searchParams.get("query"), /reid:\*/);
  assert(calls[0].options.headers["User-Agent"].includes("https://"));
  await search(req);
  assert.equal(calls.length, 1);
  assert.equal((await search({ source: "musicbrainz", keyword: "!!!" })).list.length, 0);
});

test("concurrent distinct MusicBrainz searches start at least one second apart", async () => {
  const starts = [];
  const { handlers } = load("musicbrainz-cover", async () => {
    starts.push(Date.now());
    return { status: 200, body: { recordings: [] } };
  });
  await Promise.all(["a", "b", "c"].map((keyword) => handlers.get("musicSearch")({ source: "musicbrainz", keyword })));
  assert.equal(starts.length, 3);
  assert(starts[1] - starts[0] >= 1000);
  assert(starts[2] - starts[1] >= 1000);
});

test("cover lookup chooses front, upgrades HTTPS and deduplicates/cache persists across loads", async () => {
  const calls = [];
  const storage = new Map();
  const request = async (url) => {
    calls.push(url);
    return { status: 200, body: { images: [{ front: false, image: imageUrl },
      { ...front, thumbnails: { "1200": imageUrl.replace("https:", "http:") } }] } };
  };
  const first = load("musicbrainz-cover", request, { storage });
  const req = { source: "musicbrainz", musicInfo: { releaseId: id(2), releaseGroupId: id(3) } };
  const results = await Promise.all([first.handlers.get("musicPic")(req), first.handlers.get("musicPic")(req)]);
  assert.equal(results[0].url, imageUrl);
  assert.equal(calls.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  const second = load("musicbrainz-cover", request, { storage });
  assert.equal((await second.handlers.get("musicPic")(req)).url, imageUrl);
  assert.equal(calls.length, 1);
});

test("missing release art falls back to curated group cover, never back cover", async () => {
  const calls = [];
  const { handlers } = load("musicbrainz-cover", async (url) => {
    calls.push(url);
    if (url.includes("release-group")) return { status: 200, body: { images: [front] } };
    if (url.endsWith(id(2))) return { status: 404 };
    return { status: 200, body: { images: [{ front: false, image: imageUrl }] } };
  });
  const result = await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: {
    releaseId: id(2), releaseIds: [id(2), id(4)], releaseGroupId: id(3),
  } });
  assert.equal(result.url, imageUrl);
  assert.equal(calls.length, 2);
  assert(calls[1].includes("release-group"));
});

test("missing group art falls back to another edition of the same album", async () => {
  const calls = [];
  const { handlers } = load("musicbrainz-cover", async (url) => {
    calls.push(url);
    return url.endsWith(id(4)) ? { status: 200, body: { images: [front] } } : { status: 404 };
  });
  const result = await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: {
    releaseId: id(2), releaseIds: [id(2), id(4)], releaseGroupId: id(3),
  } });
  assert.equal(result.url, imageUrl);
  assert.equal(calls.length, 3);
  assert(calls[2].endsWith(id(4)));
});

test("network failures, malformed data and invalid IDs degrade to empty results", async () => {
  for (const request of [async () => { throw new Error("offline"); },
    async () => ({ status: 503, body: "busy" }), async () => ({ status: 200, body: "invalid json" })]) {
    const { handlers } = load("musicbrainz-cover", request);
    assert.equal((await handlers.get("musicSearch")({ source: "musicbrainz", keyword: "Song" })).list.length, 0);
    assert.equal((await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: { releaseId: id(2) } })).url, "");
  }
  let calls = 0;
  const { handlers } = load("musicbrainz-cover", async () => { calls++; });
  assert.equal((await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: { releaseId: "../../bad" } })).url, "");
  assert.equal(calls, 0);
});

test("negative cover cache avoids repeat 404, transient failures are retried", async () => {
  let calls = 0;
  const { handlers } = load("musicbrainz-cover", async () => { calls++; return { status: calls === 1 ? 503 : 404 }; });
  const req = { source: "musicbrainz", musicInfo: { releaseId: id(2) } };
  const pic = handlers.get("musicPic");
  await pic(req);
  await pic(req);
  await pic(req);
  assert.equal(calls, 2);
});

test("untrusted artwork URLs are rejected", async () => {
  const { handlers } = load("musicbrainz-cover", async () => ({ status: 200,
    body: { images: [{ front: true, image: "file:///secret", thumbnails: { "1200": "https://other.invalid/a.jpg" } }] } }));
  assert.equal((await handlers.get("musicPic")({ source: "musicbrainz", musicInfo: { releaseId: id(2) } })).url, "");
});
