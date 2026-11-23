import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = new URL(process.env.ATOM_URL || "http://127.0.0.1:14558");
const report = { environment: base.origin, checkedAt: new Date().toISOString(), checks: [] };
const request = async (path, body) => {
  const response = await fetch(new URL(`/api${path}`, base), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(40000),
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
};
const check = async (name, task) => {
  const start = Date.now();
  try {
    const data = await task();
    const entry = { name, ok: true, elapsedMs: Date.now() - start, data };
    report.checks.push(entry);
    console.log(JSON.stringify(entry));
  } catch (error) {
    const entry = { name, ok: false, elapsedMs: Date.now() - start, error: error.message };
    report.checks.push(entry);
    console.error(JSON.stringify(entry));
    process.exitCode = 1;
  }
};

await check("host version", async () => {
  const info = await request("/info");
  return { version: info.version, commit: info.commit, sourceDirty: info.sourceDirty };
});
const installFlag = process.argv.indexOf("--install-from");
if (installFlag >= 0) {
  const source = process.argv[installFlag + 1];
  assert(source, "--install-from requires a script base URL reachable from Core");
  for (const name of ["musicbrainz-cover", "music-tools"]) {
    await check(`install ${name}`, async () => {
      const result = await request("/plugins/install-url", { url: new URL(`${name}.js`, source).toString() });
      assert.equal(result.ok, true, JSON.stringify(result));
      return { ok: result.ok };
    });
  }
}
await check("both plugins ready", async () => {
  let plugins;
  for (let attempt = 0; attempt < 10; attempt++) {
    plugins = await request("/plugins");
    if (["atom.music-tools", "atom.musicbrainz-cover"].every((id) =>
      plugins.some((plugin) => plugin.manifest.id === id && plugin.status.state === "ready"))) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return await Promise.all(["atom.music-tools", "atom.musicbrainz-cover"].map(async (id) => {
    const plugin = plugins.find((plugin) => plugin.manifest.id === id);
    assert.equal(plugin?.status.state, "ready", `${id} must be ready`);
    const name = id.replace("atom.", "");
    const source = await readFile(new URL(`../plugins/${name}/plugin.js`, import.meta.url));
    const hash = createHash("sha1").update(source).digest("hex");
    assert.equal(plugin.manifest.hash, hash, `${id}: installed script must match workspace`);
    return { id, enabled: plugin.enabled, type: plugin.manifest.type, hash, status: plugin.status };
  }));
});
if (report.checks.some((entry) => !entry.ok)) {
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(new URL("../artifacts/host-verification.json", import.meta.url), JSON.stringify(report, null, 2));
  process.exit(1);
}

const track = { id: "plugin-verification", source: "local", title: "Come Together",
  artists: [{ name: "The Beatles" }], album: { name: "Abbey Road" }, duration: 259000 };
for (const menuId of ["musicbrainz", "discogs", "youtube", "copy-track", "copy-album"]) {
  await check(`menu ${menuId}`, async () => {
    const result = await request("/plugins/invoke-menu", { pluginId: "atom.music-tools", menuId, track });
    assert.equal(result.ok, true);
    if (menuId.startsWith("copy")) assert.match(result.copyText, /The Beatles - /);
    else assert.match(result.openUrl, /^https:\/\//);
    return result;
  });
}
await check("menu missing album", async () => {
  const result = await request("/plugins/invoke-menu", {
    pluginId: "atom.music-tools", menuId: "copy-album", track: { ...track, album: undefined },
  });
  assert.equal(result.ok, true);
  assert.equal(result.copyText, undefined);
  assert(result.toast);
  return result;
});
for (const name of ["cover lookup", "cover cached lookup"]) {
  await check(name, async () => {
    const result = await request("/plugins/match-cover", { pluginId: "atom.musicbrainz-cover", source: "musicbrainz", track });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.data.url, /^https:\/\//);
    return result;
  });
}
await check("second album cover lookup", async () => {
  const result = await request("/plugins/match-cover", {
    pluginId: "atom.musicbrainz-cover", source: "musicbrainz",
    track: { id: "plugin-verification-2", source: "local", title: "Hotel California",
      artists: [{ name: "Eagles" }], album: { name: "Hotel California" }, duration: 390000 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.data.url, /^https:\/\//);
  return result;
});
await check("unknown recording returns no cover", async () => {
  const result = await request("/plugins/match-cover", {
    pluginId: "atom.musicbrainz-cover", source: "musicbrainz",
    track: { ...track, title: "AtomNonexistentRecording7ccf9d48", artists: [], album: undefined },
  });
  assert.equal(result.ok, false);
  return result;
});
await check("duration mismatch returns no cover", async () => {
  const result = await request("/plugins/match-cover", {
    pluginId: "atom.musicbrainz-cover", source: "musicbrainz", track: { ...track, duration: 10000 },
  });
  assert.equal(result.ok, false);
  return result;
});
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/host-verification.json", import.meta.url), JSON.stringify(report, null, 2));
