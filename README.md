# SPlayer Atom Plugin

两个独立的单文件 JavaScript 插件，使用 SPlayer Atom 已公开的插件 API。没有运行依赖、打包器或 Core 修改。

| 插件 | 功能 | API level | 权限 |
| --- | --- | --- | --- |
| [MusicBrainz Cover](plugins/musicbrainz-cover/README.md) | 无封面曲目的 MusicBrainz / Cover Art Archive 封面兜底 | 1 | 音源插件自动获得 network |
| [Music Tools](plugins/music-tools/README.md) | 歌曲菜单中的 MusicBrainz、Discogs、YouTube、哔哩哔哩搜索与复制 | 2 | ui |

## 安装

在 **Atom → 设置 → 插件管理 → 在线导入** 中分别粘贴以下 raw 地址。两个插件可以同时启用。

**MusicBrainz Cover：**

```text
https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/musicbrainz-cover/plugin.js
```

**Music Tools：**

```text
https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/music-tools/plugin.js
```

MusicBrainz Cover 在 Atom 加载无封面曲目时自动兜底，不扫描整个曲库，也不写入音频标签。它缓存的是封面 URL，图片仍需联网加载。Music Tools 安装后会出现在歌曲的上下文菜单中。

导入从 **Core 所在机器** 发起。`http://localhost` / `http://127.0.0.1` 仅适合 Core 本机调试；普通局域网 HTTP URL 不被宿主的安装接口接受。网页所在电脑的 localhost 与远端 Core 的 localhost 不是同一个地址。

同一 `@id` 重新导入会原地更新，不会增加重复条目。当前稳定 ID：`atom.musicbrainz-cover`、`atom.music-tools`。

## 开发与验证

开发工具需要 Node.js ≥22.19.0；插件本身只需要正在运行且支持对应 API level 的 Atom。Node 仅用于本地测试和脚本托管，不需要安装到用户的播放器上。

```powershell
npm test
npm run check
npm run serve
```

没有 npm 依赖，因此不用先执行 `npm install`。`serve` 仅绑定本机 `127.0.0.1:8765`，只提供这两个插件脚本。端口可用环境变量 `PORT` 调整。

如果 Core 与开发环境在同一机器：

```powershell
$env:ATOM_URL = 'http://127.0.0.1:14558'
node scripts/verify-host.mjs --install-from http://127.0.0.1:8765/
```

如果 Core 在远端，可把两个脚本复制到远端专用临时目录，并在远端启动仅绑定 loopback 的 HTTP 服务，再使用同样的导入地址。`--install-from` 会安装或替换这两个 ID；不传此参数只验证已安装插件：

```powershell
$env:ATOM_URL = 'http://你的-Core-主机:14558'
npm run verify
```

验证脚本通过现有 `/api/plugins/*` 接口调用菜单、封面匹配和失败路径，不启动播放、不修改音频标签。报告写入 `artifacts/host-verification.json`。涉及公开服务的首次封面验证需要网络可达；缓存命中不能替代首次在线验证。

`node scripts/probe-services.mjs` 可单独诊断公共服务连通性和插件候选；它使用文档形状的 `splayer` 测试适配器，不代表真实 Core 的匹配结果。实际验收使用 `verify-host.mjs`。

详细实测见 [验证记录](docs/verification.md)。

## 发布与更新

两份脚本已设置指向本仓库的 `@homepage` 与 `@updateUrl`，更新地址分别指向 `main` 分支的对应 raw `.js` 文件。可在 Atom 插件管理中检查并应用更新。

早期本地测试版没有声明更新地址，需要先使用上面的公开 URL 重新导入一次，后续即可检查更新。

维护时保持 `@updateUrl` 长期稳定，不要改成仓库 HTML 页面。发布新版递增 `@version`、按需修改 `@changelog`，保持 `@id`、`@type` 不变；同时更新封面插件的 User-Agent 版本。插件不开启自己的自动更新逻辑。

## API 和服务依据

- [Atom 插件总览](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/index.md)、[音源插件](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/source.md)、[控制插件](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/control.md)、[更新](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/update.md)。
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)、[搜索语法](https://musicbrainz.org/doc/MusicBrainz_API/Search)、[限流与客户端标识](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)。
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)。

无新增 PluginAction、Track 字段或 Core 路由；没有文件系统、媒体库数据库访问或 metadata 写入逻辑。插件私有缓存只通过公开的 `splayer.storage` 存储。
