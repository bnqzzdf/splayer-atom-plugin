/**
 * @name        Music Tools
 * @id          atom.music-tools
 * @version     1.0.1
 * @description 在 MusicBrainz、Discogs、YouTube 搜索歌曲，复制歌曲和专辑信息。
 * @type        control
 * @apiLevel    2
 * @grant       ui
 * @author      bnqzzdf
 * @homepage    https://github.com/bnqzzdf/splayer-atom-plugin
 * @updateUrl   https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/music-tools/plugin.js
 * @changelog   首次公开发布，新增插件主页与更新地址。
 */
(() => {
  "use strict";

  const zh = /^zh\b/i.test(splayer.locale || "zh-CN");
  const text = (cn, en) => zh ? cn : en;
  const menus = [
    { id: "musicbrainz", label: text("在 MusicBrainz 中搜索", "Search on MusicBrainz") },
    { id: "discogs", label: text("在 Discogs 中搜索", "Search on Discogs") },
    { id: "youtube", label: text("在 YouTube 中搜索", "Search on YouTube") },
    { id: "copy-track", label: text("复制 艺术家 - 曲名", "Copy artist - title") },
    { id: "copy-album", label: text("复制专辑信息", "Copy album information") },
  ];

  const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const names = (artists) => [...new Set((Array.isArray(artists) ? artists : [])
    .map((artist) => clean(artist?.name)).filter(Boolean))].join(" / ");
  const phrase = (value) => `"${value.replace(/[\\"]/g, "\\$&")}"`;

  splayer.on("menuClick", async ({ menuId, track } = {}) => {
    if (!menus.some((menu) => menu.id === menuId)) return {};
    const title = clean(track?.title);
    const artist = names(track?.artists);
    const album = clean(track?.album?.name);
    if (menuId === "copy-album") {
      if (!album) return { toast: text("这首歌没有专辑信息", "No album information for this track") };
      return {
        copyText: [artist, album].filter(Boolean).join(" - "),
        toast: text("已复制专辑信息", "Album information copied"),
      };
    }
    if (!title) return { toast: text("这首歌没有曲名信息", "No title for this track") };
    if (menuId === "copy-track") {
      return {
        copyText: [artist, title].filter(Boolean).join(" - "),
        toast: text("已复制歌曲信息", "Track information copied"),
      };
    }
    const query = [artist, title].filter(Boolean).join(" ");
    if (menuId === "musicbrainz") {
      const url = new URL("https://musicbrainz.org/search");
      const artists = [...new Set((Array.isArray(track?.artists) ? track.artists : [])
        .map((item) => clean(item?.name)).filter(Boolean))];
      url.searchParams.set("query", `recording:${phrase(title)}${artists.map((name) => ` AND artistname:${phrase(name)}`).join("")}`);
      url.searchParams.set("type", "recording");
      url.searchParams.set("method", "advanced");
      return { openUrl: url.toString() };
    }
    if (menuId === "discogs") {
      return { openUrl: `https://www.discogs.com/search/?q=${encodeURIComponent(query)}&type=all` };
    }
    return { openUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` };
  });

  splayer.register({ menus });
})();
