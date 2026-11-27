/**
 * @name        Liner Notes
 * @id          atom.liner-notes
 * @version     1.0.0
 * @description 唱片内页评论源：展示 MusicBrainz 制作人员、发行档案、Cover Art Archive 实体图鉴与 Wikipedia 背景故事。
 * @type        source
 * @apiLevel    3
 * @author      bnqzzdf
 * @homepage    https://github.com/bnqzzdf/splayer-atom-plugin
 * @updateUrl   https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/liner-notes/plugin.js
 * @changelog   初版发布：支持 MusicBrainz 演职员表、发行档案、CAA 实体图鉴与 Wikipedia 背景故事。
 */
(() => {
  "use strict";

  // Keep a reachable maintainer contact in this header before distributing a fork.
  const USER_AGENT = "SPlayerAtomLinerNotes/1.0.0 (https://github.com/bnqzzdf/splayer-atom-plugin/issues)";
  const SOURCE = "liner-notes";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const QID = /^Q\d+$/;
  const zh = /^zh\b/i.test(splayer.locale || "zh-CN");
  const text = (cn, en) => zh ? cn : en;

  const searchCache = new Map();
  const notesCache = new Map();
  const pending = new Map();
  let nextMbAt = 0;
  let mbGate = Promise.resolve();
  let queuedMb = 0;
  let hydrate;
  let persist = Promise.resolve();

  const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const keyOf = (value) => clean(value).normalize("NFKC").toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const warn = (message) => splayer.log.warn(`Liner Notes: ${message}`);

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

  const parseDateMs = (value) => {
    const raw = clean(value);
    if (!raw) return undefined;
    const match = raw.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2] || 1) - 1;
    const day = Number(match[3] || 1);
    const ts = Date.UTC(year, month, day);
    return Number.isFinite(ts) ? ts : undefined;
  };
  const formatDuration = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Shared 1100ms MusicBrainz rate-limit gate across search & detail lookups.
  const acquireMbSlot = async (maxWaitMs = 5000) => {
    if (queuedMb >= 4 || nextMbAt - Date.now() > maxWaitMs) return false;
    queuedMb++;
    const queuedAt = Date.now();
    const gate = mbGate.then(async () => {
      if (Date.now() - queuedAt > maxWaitMs) return false;
      let wait = nextMbAt - Date.now();
      while (wait > 0) {
        if (Date.now() - queuedAt + wait > maxWaitMs) return false;
        await sleep(wait);
        wait = nextMbAt - Date.now();
      }
      nextMbAt = Date.now() + 1100;
      return true;
    });
    mbGate = gate.then(() => {});
    try { return await gate; } finally { queuedMb--; }
  };

  const mbRequest = async (url, timeout, maxWaitMs = 4500) => {
    const allowed = await acquireMbSlot(maxWaitMs);
    if (!allowed) return { status: 0, body: null };
    try {
      const response = await splayer.request(url, {
        responseType: "json",
        timeout,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (response.status === 429 || response.status === 503) {
        nextMbAt = Math.max(nextMbAt, Date.now() + 5000);
      }
      return response;
    } catch {
      return { status: 0, body: null };
    }
  };

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
      if (!UUID.test(recording?.id) || !clean(recording.title) ||
        !Number.isFinite(recording.length) || recording.length <= 0) continue;
      const singer = (Array.isArray(recording["artist-credit"]) ? recording["artist-credit"] : [])
        .map((credit) => typeof credit === "string" ? credit :
          `${clean(credit?.name || credit?.artist?.name)}${credit?.joinphrase || ""}`).join("").trim();
      const releases = (Array.isArray(recording.releases) ? recording.releases : [])
        .filter((release) => UUID.test(release?.id) && clean(release.title))
        .sort((a, b) => releaseRank(b) - releaseRank(a) || clean(a.date).localeCompare(clean(b.date)));
      const groups = new Map();
      for (const release of releases) {
        const groupId = release["release-group"]?.id;
        const key = `${UUID.test(groupId) ? groupId : release.id}:${keyOf(release.title)}`;
        if (groups.has(key)) { groups.get(key).releaseIds.push(release.id); continue; }
        if (groups.size >= 6) continue;
        const candidate = {
          id: recording.id,
          name: clean(recording.title),
          singer,
          album: clean(release.title),
          releaseId: release.id,
          releaseIds: [release.id],
          durationMs: recording.length,
        };
        if (UUID.test(groupId)) candidate.releaseGroupId = groupId;
        if (clean(recording["first-release-date"])) candidate.firstReleaseDate = clean(recording["first-release-date"]);
        groups.set(key, candidate);
      }
      result.push(...groups.values());
      if (result.length >= 400) break;
    }
    return result.slice(0, 400);
  };

  splayer.on("musicSearch", async ({ source, keyword, page = 1 } = {}) => {
    if (source !== SOURCE) return { list: [] };
    keyword = clean(keyword).slice(0, 512);
    if (!keyword) return { list: [] };
    const pageNo = Math.min(10, Math.max(1, Math.floor(Number(page) || 1)));
    const query = searchQuery(keyword);
    if (!query) return { list: [] };
    // Host comments matcher passes limit=20; always query 100 recordings so remixes don't crowd out originals.
    const count = 100;
    const key = `${query}:${pageNo}:${count}`;
    const hit = cached(searchCache, key);
    if (hit !== undefined) return { list: hit };
    return once(`search:${key}`, async () => {
      const url = new URL("https://musicbrainz.org/ws/2/recording/");
      url.searchParams.set("query", query);
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", String(count));
      url.searchParams.set("offset", String((pageNo - 1) * count));
      const response = await mbRequest(url.toString(), 7000, 4500);
      if (response.status !== 200 || !Array.isArray(response.body?.recordings)) {
        if (response.status) warn(`search unavailable (HTTP ${response.status})`);
        return { list: [] };
      }
      const list = candidates(response.body);
      boundedSet(searchCache, key, { value: list, expires: Date.now() + 600000 }, 48);
      return { list };
    });
  });

  const httpsHostUrl = (value, allowedHosts) => {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return "";
      const host = url.hostname.toLowerCase();
      if (!allowedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "";
      url.protocol = "https:";
      return url.toString();
    } catch { return ""; }
  };
  const httpsCaaImage = (value) => httpsHostUrl(value, ["archive.org", "coverartarchive.org"]);
  const httpsWikiImage = (value) => httpsHostUrl(value, ["wikimedia.org", "wikipedia.org"]);

  const loadNotesCache = () => hydrate || (hydrate = (async () => {
    try {
      const entries = await splayer.storage.get("notes-v1");
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-64)) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        const data = entry[1];
        if (data?.expires > Date.now() && data.value &&
          Array.isArray(data.value.hot) && Array.isArray(data.value.new)) {
          boundedSet(notesCache, entry[0], data, 64);
        }
      }
    } catch { warn("notes cache could not be read"); }
  })());
  const saveNotesCache = (key, value, ttlMs) => {
    boundedSet(notesCache, key, { value, expires: Date.now() + ttlMs }, 64);
    persist = persist.catch(() => {}).then(() => splayer.storage.set("notes-v1", [...notesCache]))
      .catch(() => warn("notes cache could not be saved"));
  };

  // Extract Wikidata Q-ID or direct Wikipedia link from MusicBrainz url-rels.
  const extractWikiRef = (relations) => {
    let qid = "";
    let wikiUrl = null;
    for (const rel of Array.isArray(relations) ? relations : []) {
      const resource = clean(rel?.url?.resource);
      if (!resource) continue;
      if (!qid) {
        const wd = resource.match(/^https?:\/\/(?:www\.)?wikidata\.org\/wiki\/(Q\d+)/i);
        if (wd && QID.test(wd[1].toUpperCase())) qid = wd[1].toUpperCase();
      }
      if (!wikiUrl) {
        const wp = resource.match(/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^?#]+)(?:[?#].*)?$/i);
        if (wp) {
          try {
            wikiUrl = { lang: wp[1].toLowerCase(), title: decodeURIComponent(wp[2].replace(/_/g, " ")) };
          } catch { /* ignore malformed page titles */ }
        }
      }
    }
    return { qid, wikiUrl };
  };

  const fetchWikiSummary = async (lang, title, timeout) => {
    if (!lang || !title || timeout < 1200) return null;
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      const response = await splayer.request(url, {
        responseType: "json",
        timeout,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (response.status !== 200 || !clean(response.body?.extract)) return null;
      if (response.body?.type === "disambiguation") return null;
      return {
        lang,
        title: clean(response.body.title) || title,
        description: clean(response.body.description),
        extract: clean(response.body.extract),
        pageUrl: httpsHostUrl(response.body.content_urls?.desktop?.page, ["wikipedia.org"]) ||
          `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        thumbnail: httpsWikiImage(response.body.thumbnail?.source),
      };
    } catch { return null; }
  };

  const resolveWikipedia = async (ref, deadline) => {
    if (!ref.qid && !ref.wikiUrl) return null;
    const preferredLangs = zh ? ["zh", "en"] : ["en", "zh"];
    if (ref.qid) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) return null;
      try {
        const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ref.qid}&props=sitelinks&format=json`;
        const wdResp = await splayer.request(wdUrl, {
          responseType: "json",
          timeout: Math.min(3500, remaining - 500),
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        const sitelinks = wdResp.status === 200 ? wdResp.body?.entities?.[ref.qid]?.sitelinks : null;
        if (sitelinks) {
          for (const lang of preferredLangs) {
            const title = clean(sitelinks[`${lang}wiki`]?.title);
            if (!title) continue;
            const summary = await fetchWikiSummary(lang, title, Math.min(4000, deadline - Date.now()));
            if (summary) return summary;
          }
        }
      } catch { /* fall through to direct wikiUrl if present */ }
    }
    if (ref.wikiUrl) {
      return fetchWikiSummary(ref.wikiUrl.lang, ref.wikiUrl.title, Math.min(4000, deadline - Date.now()));
    }
    return null;
  };

  const ART_TYPE_LABEL = {
    Back: ["封底", "Back"],
    Booklet: ["内页手册", "Booklet"],
    Medium: ["盘面", "Medium"],
    Tray: ["托盘内页", "Tray"],
    Obi: ["侧标 Obi", "Obi"],
    Liner: ["内页", "Liner"],
    Poster: ["海报", "Poster"],
    Front: ["封面", "Front"],
  };

  const fetchPhysicalArt = async (releaseId, releaseGroupId, deadline) => {
    const targets = [];
    if (UUID.test(releaseId)) targets.push(["release", releaseId]);
    if (UUID.test(releaseGroupId)) targets.push(["release-group", releaseGroupId]);
    for (const [kind, id] of targets) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) break;
      try {
        const response = await splayer.request(`https://coverartarchive.org/${kind}/${id}`, {
          responseType: "json",
          timeout: Math.min(4500, remaining),
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (response.status !== 200 || !Array.isArray(response.body?.images)) continue;
        const images = response.body.images;
        // Prefer non-front physical packaging images (back, booklet, disc medium, obi); fall back to front if none.
        const extras = images.filter((img) => !img.front);
        const picked = (extras.length ? extras : images).slice(0, 6);
        const urls = [];
        const types = new Set();
        for (const img of picked) {
          const url = [img.thumbnails?.["500"], img.thumbnails?.["1200"], img.thumbnails?.["250"], img.image]
            .map(httpsCaaImage).find(Boolean);
          if (!url) continue;
          urls.push(url);
          for (const kindName of Array.isArray(img.types) ? img.types : []) {
            if (ART_TYPE_LABEL[kindName]) types.add(text(ART_TYPE_LABEL[kindName][0], ART_TYPE_LABEL[kindName][1]));
          }
        }
        if (urls.length) return { urls, types: [...types] };
      } catch { /* ignore CAA errors */ }
    }
    return null;
  };

  const ROLE_LABEL = {
    composer: ["作曲", "Composer"],
    lyricist: ["作词", "Lyricist"],
    writer: ["词曲", "Writer"],
    arranger: ["编曲", "Arranger"],
    producer: ["制作人", "Producer"],
    "co-producer": ["联合制作", "Co-producer"],
    mix: ["混音", "Mix"],
    mastering: ["母带", "Mastering"],
    engineer: ["录音师", "Engineer"],
    recording: ["录音", "Recording"],
    vocal: ["人声", "Vocals"],
    instrument: ["乐器", "Instruments"],
    performer: ["演奏", "Performer"],
    orchestra: ["管弦乐", "Orchestra"],
    conductor: ["指挥", "Conductor"],
  };

  const collectCredits = (recording) => {
    const buckets = new Map();
    const addCredit = (roleKey, name, attrs = []) => {
      if (!name) return;
      const label = ROLE_LABEL[roleKey] ? text(ROLE_LABEL[roleKey][0], ROLE_LABEL[roleKey][1]) : roleKey;
      const suffix = attrs.length ? ` (${attrs.join(", ")})` : "";
      const entry = `${name}${suffix}`;
      if (!buckets.has(label)) buckets.set(label, new Set());
      buckets.get(label).add(entry);
    };

    const works = [];
    for (const rel of Array.isArray(recording?.relations) ? recording.relations : []) {
      const type = clean(rel?.type).toLowerCase();
      if (rel?.artist?.name) {
        const attrs = (Array.isArray(rel.attributes) ? rel.attributes : []).map(clean).filter(Boolean);
        addCredit(type, clean(rel.artist.name), attrs);
      } else if (rel?.work) {
        works.push(rel.work);
      }
    }
    for (const work of works) {
      for (const rel of Array.isArray(work?.relations) ? work.relations : []) {
        const type = clean(rel?.type).toLowerCase();
        if (rel?.artist?.name) {
          const attrs = (Array.isArray(rel.attributes) ? rel.attributes : []).map(clean).filter(Boolean);
          addCredit(type, clean(rel.artist.name), attrs);
        }
      }
    }

    const lines = [];
    for (const [label, names] of buckets) {
      lines.push(`${label}：${[...names].slice(0, 8).join(" / ")}`);
    }
    return { lines, works };
  };

  const buildCards = ({ recording, musicInfo, wiki, wikiScope, art }) => {
    const hot = [];
    const releasesTab = [];
    const recId = recording?.id || musicInfo.id;
    const title = clean(recording?.title) || clean(musicInfo.name);
    const singer = (Array.isArray(recording?.["artist-credit"]) ? recording["artist-credit"] : [])
      .map((credit) => typeof credit === "string" ? credit :
        `${clean(credit?.name || credit?.artist?.name)}${credit?.joinphrase || ""}`).join("").trim() ||
      clean(musicInfo.singer);
    const firstDate = clean(recording?.["first-release-date"]) || clean(musicInfo.firstReleaseDate);
    const firstDateMs = parseDateMs(firstDate);
    const { lines: creditLines, works } = collectCredits(recording);

    // 1. Wikipedia Story Card (top of Hot tab because it's the most enjoyable read!)
    if (wiki) {
      const scopeLabel = wikiScope === "album"
        ? text("维基百科 · 专辑背景", "Wikipedia · Album Story")
        : text("维基百科 · 曲目背景", "Wikipedia · Song Story");
      const header = wiki.description ? `${wiki.title} — ${wiki.description}` : wiki.title;
      hot.push({
        id: `wiki:${recId}`,
        userName: scopeLabel,
        ...(wiki.thumbnail ? { avatar: wiki.thumbnail } : {}),
        text: `${header}\n\n${wiki.extract}`,
        ...(firstDateMs ? { time: firstDateMs } : {}),
        reply: [{
          id: `wiki-link:${recId}`,
          userName: text("词条来源", "Source"),
          text: wiki.pageUrl,
        }],
      });
    }

    // 2. Release Profile Card
    const profileLines = [];
    if (title) profileLines.push(`${text("曲名", "Title")}：${title}`);
    if (singer) profileLines.push(`${text("艺术家", "Artist")}：${singer}`);
    if (clean(musicInfo.album)) profileLines.push(`${text("专辑", "Album")}：${clean(musicInfo.album)}`);
    if (firstDate) profileLines.push(`${text("首次发行", "First Release")}：${firstDate}`);
    const dur = formatDuration(recording?.length || musicInfo.durationMs);
    if (dur) profileLines.push(`${text("录音时长", "Duration")}：${dur}`);
    const languages = [...new Set(works.flatMap((w) => Array.isArray(w.languages) ? w.languages : []).map(clean).filter(Boolean))];
    if (languages.length) profileLines.push(`${text("歌词语言", "Language")}：${languages.join(" / ")}`);
    const tags = (Array.isArray(recording?.tags) ? recording.tags : [])
      .filter((t) => clean(t?.name))
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 6)
      .map((t) => clean(t.name));
    if (tags.length) profileLines.push(`${text("风格标签", "Tags")}：${tags.join(" · ")}`);
    const isrcs = (Array.isArray(recording?.isrcs) ? recording.isrcs : []).map(clean).filter(Boolean);
    if (isrcs.length) profileLines.push(`ISRC：${isrcs.slice(0, 3).join(", ")}`);

    if (profileLines.length) {
      hot.push({
        id: `profile:${recId}`,
        userName: text("唱片档案 · MusicBrainz", "Release Profile · MusicBrainz"),
        text: profileLines.join("\n"),
        ...(firstDateMs ? { time: firstDateMs } : {}),
        reply: [{
          id: `mb-link:${recId}`,
          userName: "MusicBrainz",
          text: `https://musicbrainz.org/recording/${recId}`,
        }],
      });
    }

    // 3. Credits & Personnel Card
    if (creditLines.length) {
      const workTitles = [...new Set(works.map((w) => clean(w.title)).filter(Boolean))];
      hot.push({
        id: `credits:${recId}`,
        userName: text("制作与演职员表", "Credits & Personnel"),
        text: creditLines.join("\n"),
        ...(firstDateMs ? { time: firstDateMs } : {}),
        ...(workTitles.length ? {
          reply: [{
            id: `work:${recId}`,
            userName: text("关联作品", "Musical Work"),
            text: workTitles.join(" / "),
          }],
        } : {}),
      });
    }

    // 4. Physical Artwork Card (CAA back / booklet / medium)
    if (art && art.urls.length) {
      const caption = art.types.length
        ? text(`收录 ${art.types.join("、")}等 ${art.urls.length} 张实体扫描图。`,
          `Includes ${art.urls.length} physical scan(s): ${art.types.join(", ")}.`)
        : text(`收录 ${art.urls.length} 张实体唱片扫描图。`, `Includes ${art.urls.length} physical scan(s).`);
      hot.push({
        id: `art:${recId}`,
        userName: text("实体图鉴 · Cover Art Archive", "Physical Artwork · Cover Art Archive"),
        text: caption,
        images: art.urls,
        ...(firstDateMs ? { time: firstDateMs } : {}),
      });
    }

    // New Tab: Chronological Release Editions Timeline (newest first to fit "最新" tab, tagging earliest as Original)
    const releases = (Array.isArray(recording?.releases) ? recording.releases : [])
      .filter((r) => UUID.test(r?.id) && clean(r.title));
    const dated = releases.filter((r) => clean(r.date));
    const earliestDate = dated.map((r) => clean(r.date)).sort()[0] || "";
    const sortedReleases = releases.slice().sort((a, b) =>
      clean(b.date).localeCompare(clean(a.date)) || releaseRank(b) - releaseRank(a));

    for (const rel of sortedReleases.slice(0, 30)) {
      const dateStr = clean(rel.date);
      const isOriginal = Boolean(earliestDate && dateStr === earliestDate && rel.status === "Official");
      const meta = [];
      if (rel.status) meta.push(`${text("发行状态", "Status")}：${rel.status}`);
      if (clean(rel.country)) meta.push(`${text("发行地区", "Country")}：${clean(rel.country)}`);
      if (dateStr) meta.push(`${text("发行日期", "Date")}：${dateStr}`);
      if (clean(rel.barcode)) meta.push(`${text("条形码", "Barcode")}：${clean(rel.barcode)}`);
      if (clean(rel.disambiguation)) meta.push(`${text("版本备注", "Edition")}：${clean(rel.disambiguation)}`);
      const ts = parseDateMs(dateStr);
      releasesTab.push({
        id: `rel:${rel.id}`,
        userName: isOriginal ? `${clean(rel.title)} [${text("初版", "Original")}]` : clean(rel.title),
        text: meta.join("\n") || text("MusicBrainz 收录发行版", "MusicBrainz release edition"),
        ...(ts ? { time: ts } : {}),
      });
    }

    return { hot, new: releasesTab };
  };

  const resolveLinerNotes = async (musicInfo) => {
    const recId = musicInfo?.id;
    if (!UUID.test(recId)) return { hot: [], new: [] };
    await loadNotesCache();
    const cacheKey = `${zh ? "zh" : "en"}:${recId}:${musicInfo.releaseId || ""}`;
    const hit = cached(notesCache, cacheKey);
    if (hit !== undefined) return hit;

    return once(`notes:${cacheKey}`, async () => {
      const deadline = Date.now() + 13500;
      const recUrl = `https://musicbrainz.org/ws/2/recording/${recId}?inc=artist-credits+releases+release-groups+artist-rels+work-rels+work-level-rels+url-rels+tags+isrcs&fmt=json`;
      const recResp = await mbRequest(recUrl, Math.min(6000, deadline - Date.now()), 3500);
      if (recResp.status === 404) {
        const empty = { hot: [], new: [] };
        saveNotesCache(cacheKey, empty, 3600000);
        return empty;
      }
      if (recResp.status !== 200 || !recResp.body?.id) {
        if (recResp.status) warn(`recording lookup unavailable (HTTP ${recResp.status})`);
        return { hot: [], new: [] };
      }
      const recording = recResp.body;
      const releases = Array.isArray(recording.releases) ? recording.releases : [];

      // Look for Wikipedia/Wikidata links on recording or its linked works first.
      let wikiScope = "song";
      const allSongRels = [
        ...(Array.isArray(recording.relations) ? recording.relations : []),
        ...(Array.isArray(recording.relations) ? recording.relations : [])
          .flatMap((rel) => Array.isArray(rel?.work?.relations) ? rel.work.relations : []),
      ];
      let wikiRef = extractWikiRef(allSongRels);

      // If no song-level Wikipedia link, try the album's release-group url-rels if budget allows.
      const releaseGroupId = UUID.test(musicInfo.releaseGroupId)
        ? musicInfo.releaseGroupId
        : releases.find((r) => UUID.test(r?.["release-group"]?.id))?.["release-group"]?.id;
      if (!wikiRef.qid && !wikiRef.wikiUrl && UUID.test(releaseGroupId) && deadline - Date.now() > 5500) {
        const rgUrl = `https://musicbrainz.org/ws/2/release-group/${releaseGroupId}?inc=url-rels&fmt=json`;
        const rgResp = await mbRequest(rgUrl, Math.min(4500, deadline - Date.now()), 2500);
        if (rgResp.status === 200 && Array.isArray(rgResp.body?.relations)) {
          wikiRef = extractWikiRef(rgResp.body.relations);
          wikiScope = "album";
        }
      }

      // Fetch Wikipedia summary and CAA physical artwork in parallel (neither hits MusicBrainz rate limit).
      const releaseId = UUID.test(musicInfo.releaseId)
        ? musicInfo.releaseId
        : releases.find((r) => UUID.test(r?.id))?.id;
      const [wiki, art] = await Promise.all([
        resolveWikipedia(wikiRef, deadline),
        fetchPhysicalArt(releaseId, releaseGroupId, deadline),
      ]);

      const bundle = buildCards({ recording, musicInfo, wiki, wikiScope, art });
      saveNotesCache(cacheKey, bundle, 7 * 86400000);
      return bundle;
    });
  };

  splayer.on("musicComment", async ({ source, musicInfo, type = "hot", page = 1, limit = 20 } = {}) => {
    const pageNo = Math.max(1, Math.floor(Number(page) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    if (source !== SOURCE || !musicInfo) {
      return { list: [], total: 0, page: pageNo, limit: pageSize };
    }
    const bundle = await resolveLinerNotes(musicInfo);
    const items = type === "new" ? bundle.new : bundle.hot;
    const start = (pageNo - 1) * pageSize;
    return {
      list: items.slice(start, start + pageSize),
      total: items.length,
      page: pageNo,
      limit: pageSize,
    };
  });

  splayer.register({
    sources: {
      [SOURCE]: {
        name: text("唱片内页", "Liner Notes"),
        actions: ["musicSearch", "musicComment"],
      },
    },
  });
})();
