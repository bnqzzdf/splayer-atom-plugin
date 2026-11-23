/**
 * @name        MusicBrainz Cover
 * @id          atom.musicbrainz-cover
 * @version     1.0.1
 * @description 无封面曲目的 MusicBrainz / Cover Art Archive 封面兜底。
 * @type        source
 * @apiLevel    1
 * @author      bnqzzdf
 * @homepage    https://github.com/bnqzzdf/splayer-atom-plugin
 * @updateUrl   https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/musicbrainz-cover/plugin.js
 * @changelog   首次公开发布，新增插件主页与更新地址。
 */
(() => {
  "use strict";

  // Keep a reachable maintainer contact in this header before distributing a fork.
  const USER_AGENT = "SPlayerAtomMusicBrainzCover/1.0.1 (https://github.com/bnqzzdf/splayer-atom-plugin/issues)";
  const SOURCE = "musicbrainz";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const searchCache = new Map();
  const coverCache = new Map();
  const pending = new Map();
  let nextSearchAt = 0;
  let searchGate = Promise.resolve();
  let queuedSearches = 0;
  let hydrate;
  let persist = Promise.resolve();

  const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const keyOf = (value) => clean(value).normalize("NFKC").toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const warn = (message) => splayer.log.warn(`MusicBrainz Cover: ${message}`);
  const boundedSet = (map, key, value, limit) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
  };
  const cached = (map, key) => {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { map.delete(key); return undefined; }
    return entry.value;
  };
  const once = (key, task) => {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(task).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };

  // Host supplies a single combined keyword, so do not guess a title/artist split.
  // Every token can match either recording or artist; quote tokens to escape Lucene syntax.
  const searchQuery = (keyword) => {
    const tokens = [...new Set(keyword.normalize("NFKC").match(/[\p{L}\p{M}\p{N}]+/gu) || [])];
    return tokens.slice(0, 40).map((token) => `(recording:"${token}" OR artist:"${token}")`).join(" AND ");
  };
  const releaseRank = (release) => {
    const group = release["release-group"] || {};
    const secondary = group["secondary-types"] || [];
    return (release.status === "Official" ? 4 : 0) +
      (group["primary-type"] === "Album" ? 2 : 0) -
      (secondary.includes("Compilation") ? 4 : 0) - (secondary.includes("Live") ? 2 : 0);
  };
  const candidates = (body) => {
    const result = [];
    const recordings = (Array.isArray(body?.recordings) ? body.recordings : []).slice()
      .sort((a, b) => Number(Number.isFinite(b?.length)) - Number(Number.isFinite(a?.length)));
    for (const recording of recordings) {
      // Without a duration the host's hard matching gate cannot protect against
      // remixes/interview snippets. Prefer a miss over a plausible wrong cover.
      if (!UUID.test(recording?.id) || !clean(recording.title) ||
        !Number.isFinite(recording.length) || recording.length <= 0) continue;
      const singer = (Array.isArray(recording["artist-credit"]) ? recording["artist-credit"] : [])
        .map((credit) => typeof credit === "string" ? credit :
          `${clean(credit.name || credit.artist?.name)}${credit.joinphrase || ""}`).join("").trim();
      const releases = (Array.isArray(recording.releases) ? recording.releases : [])
        .filter((release) => UUID.test(release?.id) && clean(release.title))
        .sort((a, b) => releaseRank(b) - releaseRank(a) || clean(a.date).localeCompare(clean(b.date)));
      const groups = new Map();
      for (const release of releases) {
        const groupId = release["release-group"]?.id;
        const key = `${UUID.test(groupId) ? groupId : release.id}:${keyOf(release.title)}`;
        if (groups.has(key)) { groups.get(key).releaseIds.push(release.id); continue; }
        // Preserve distinct albums for the host's album bonus, but bound result size.
        if (groups.size >= 6) continue;
        const candidate = {
          id: recording.id,
          name: clean(recording.title),
          singer,
          album: clean(release.title),
          releaseId: release.id,
          releaseIds: [release.id],
        };
        if (UUID.test(groupId)) candidate.releaseGroupId = groupId;
        if (Number.isFinite(recording.length) && recording.length > 0) candidate.durationMs = recording.length;
        groups.set(key, candidate);
      }
      result.push(...groups.values());
      if (result.length >= 400) break;
    }
    return result.slice(0, 400);
  };

  splayer.on("musicSearch", async ({ source, keyword, page = 1, limit = 100 } = {}) => {
    if (source !== SOURCE) return { list: [] };
    keyword = clean(keyword).slice(0, 512);
    if (!keyword) return { list: [] };
    const count = Math.min(100, Math.max(1, Math.floor(Number(limit) || 100)));
    const pageNo = Math.min(10, Math.max(1, Math.floor(Number(page) || 1)));
    const query = searchQuery(keyword);
    if (!query) return { list: [] };
    const key = `${query}:${pageNo}:${count}`;
    const hit = cached(searchCache, key);
    if (hit !== undefined) return { list: hit };
    return once(`search:${key}`, async () => {
      // Gate actual request starts, including concurrent callers. No unbounded queue:
      // the host's musicSearch handler expires after 15 seconds.
      if (queuedSearches >= 4 || nextSearchAt - Date.now() > 5000) return { list: [] };
      queuedSearches++;
      const queuedAt = Date.now();
      const gate = searchGate.then(async () => {
        if (Date.now() - queuedAt > 5000) return false;
        let wait = nextSearchAt - Date.now();
        while (wait > 0) {
          if (Date.now() - queuedAt + wait > 5000) return false;
          await sleep(wait);
          wait = nextSearchAt - Date.now();
        }
        nextSearchAt = Date.now() + 1100;
        return true;
      });
      searchGate = gate.then(() => {});
      let allowed;
      try { allowed = await gate; } finally { queuedSearches--; }
      if (!allowed) return { list: [] };
      try {
        const url = new URL("https://musicbrainz.org/ws/2/recording/");
        url.searchParams.set("query", query);
        url.searchParams.set("fmt", "json");
        url.searchParams.set("limit", String(count));
        url.searchParams.set("offset", String((pageNo - 1) * count));
        const response = await splayer.request(url.toString(), {
          responseType: "json", timeout: 7000,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (response.status !== 200 || !Array.isArray(response.body?.recordings)) {
          if (response.status === 429 || response.status === 503) nextSearchAt = Math.max(nextSearchAt, Date.now() + 5000);
          warn(`search unavailable (HTTP ${response.status})`);
          return { list: [] };
        }
        const list = candidates(response.body);
        boundedSet(searchCache, key, { value: list, expires: Date.now() + 600000 }, 48);
        return { list };
      } catch { warn("search request failed"); return { list: [] }; }
    });
  });

  const httpsImage = (value) => {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return "";
      if (!(url.hostname === "archive.org" || url.hostname.endsWith(".archive.org") ||
        url.hostname === "coverartarchive.org")) return "";
      url.protocol = "https:";
      return url.toString();
    } catch { return ""; }
  };
  const loadCovers = () => hydrate || (hydrate = (async () => {
    try {
      const entries = await splayer.storage.get("covers-v1");
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-128)) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        const data = entry[1];
        if (data?.expires > Date.now() && (data.value === "" || httpsImage(data.value))) {
          boundedSet(coverCache, entry[0], data, 128);
        }
      }
    } catch { warn("cover cache could not be read"); }
  })());
  const saveCover = (key, url) => {
    boundedSet(coverCache, key, {
      value: url, expires: Date.now() + (url ? 7 * 86400000 : 3600000),
    }, 128);
    // Serialize writes so older snapshots cannot overwrite newer results.
    persist = persist.catch(() => {}).then(() => splayer.storage.set("covers-v1", [...coverCache]))
      .catch(() => warn("cover cache could not be saved"));
  };
  const coverFor = async (kind, id, timeout) => {
    const key = `${kind}:${id}`;
    const hit = cached(coverCache, key);
    if (hit !== undefined) return hit;
    return once(key, async () => {
      try {
        const response = await splayer.request(`https://coverartarchive.org/${kind}/${id}`, {
          responseType: "json", timeout,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (response.status === 404) { saveCover(key, ""); return ""; }
        if (response.status !== 200 || !Array.isArray(response.body?.images)) {
          warn(`cover unavailable (HTTP ${response.status})`);
          return "";
        }
        const front = response.body.images.find((image) => image.front === true);
        const url = front ? [front.thumbnails?.["1200"], front.thumbnails?.["500"],
          front.thumbnails?.["250"], front.image].map(httpsImage).find(Boolean) || "" : "";
        saveCover(key, url);
        return url;
      } catch { warn("cover request failed"); return ""; }
    });
  };

  splayer.on("musicPic", async ({ source, musicInfo } = {}) => {
    if (source !== SOURCE || !musicInfo) return { url: "" };
    const deadline = Date.now() + 13500;
    await loadCovers();
    const ids = [...new Set([musicInfo.releaseId,
      ...(Array.isArray(musicInfo.releaseIds) ? musicInfo.releaseIds : [])].filter((id) => UUID.test(id)))];
    // Check the selected edition first, then the group's curated cover before
    // spending time on alternate editions. Budget stays below the host's 15s.
    const targets = [];
    if (ids[0]) targets.push(["release", ids[0]]);
    if (UUID.test(musicInfo.releaseGroupId)) targets.push(["release-group", musicInfo.releaseGroupId]);
    targets.push(...ids.slice(1, 3).map((id) => ["release", id]));
    for (const [kind, id] of targets) {
      const remaining = deadline - Date.now();
      if (remaining < 1000) break;
      const url = await coverFor(kind, id, Math.min(6500, remaining));
      if (url) return { url };
    }
    return { url: "" };
  });

  splayer.register({ sources: {
    [SOURCE]: { name: "MusicBrainz / Cover Art Archive", actions: ["musicSearch", "musicPic"] },
  } });
})();
