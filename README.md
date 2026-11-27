# SPlayer Atom Plugin

三个独立的单文件 JavaScript 插件，使用 SPlayer Atom 已公开的插件 API。没有运行依赖、打包器或 Core 修改。

| 插件 | 功能 | API level | 权限 |
| --- | --- | --- | --- |
| [MusicBrainz Cover](plugins/musicbrainz-cover/README.md) | 无封面曲目的 MusicBrainz / Cover Art Archive 封面兜底 | 1 | 音源插件自动获得 network |
| [Music Tools](plugins/music-tools/README.md) | 歌曲菜单中的 MusicBrainz、Discogs、YouTube、哔哩哔哩搜索与复制 | 2 | ui |
| [Liner Notes](plugins/liner-notes/README.md) | 评论区的唱片档案、制作人员、实体扫描和维基百科背景 | 3 | 音源插件自动获得 network |

## 安装

在 **Atom → 设置 → 插件管理 → 在线导入** 中粘贴所需插件的 raw 地址。三个插件可以同时启用。Liner Notes 的在线地址在脚本发布到 `main` 后生效。

**MusicBrainz Cover：**

```text
https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/musicbrainz-cover/plugin.js
```

**Music Tools：**

```text
https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/music-tools/plugin.js
```

**Liner Notes：**

```text
https://raw.githubusercontent.com/bnqzzdf/splayer-atom-plugin/main/plugins/liner-notes/plugin.js
```

MusicBrainz Cover 在 Atom 加载无封面曲目时自动兜底，不扫描整个曲库，也不写入音频标签。它缓存的是封面 URL，图片仍需联网加载。Music Tools 安装后会出现在歌曲的上下文菜单中。Liner Notes 启用后可在歌曲评论的来源下拉中选择 **唱片内页**，需要支持 API level 3 的 Atom。

导入从 **Core 所在机器** 发起。`http://localhost` / `http://127.0.0.1` 仅适合 Core 本机调试；普通局域网 HTTP URL 不被宿主的安装接口接受。网页所在电脑的 localhost 与远端 Core 的 localhost 不是同一个地址。

同一 `@id` 重新导入会原地更新，不会增加重复条目。稳定 ID 为 `atom.musicbrainz-cover`、`atom.music-tools` 和 `atom.liner-notes`。

## 开发与验证

开发工具需要 Node.js ≥22.19.0；插件本身只需要正在运行且支持对应 API level 的 Atom。Node 仅用于本地测试和脚本托管，不需要安装到用户的播放器上。

```powershell
npm test
npm run check
npm run serve
```

没有 npm 依赖，因此不用先执行 `npm install`。`serve` 仅绑定本机 `127.0.0.1:8765`，提供 `musicbrainz-cover.js`、`music-tools.js` 和 `liner-notes.js`。端口可用环境变量 `PORT` 调整。

如果 Core 与开发环境在同一机器：

```powershell
$env:ATOM_URL = 'http://127.0.0.1:14558'
node scripts/verify-host.mjs --install-from http://127.0.0.1:8765/ --liner-notes
```

如果 Core 在远端，可按上述文件名把待验证的脚本复制到远端专用临时目录，并在远端启动仅绑定 loopback 的 HTTP 服务。默认验证 MusicBrainz Cover 和 Music Tools，添加 `--liner-notes` 单独验证唱片内页。`--install-from` 会安装或替换本次验证的插件，省略该参数时只验证已安装的插件。

```powershell
$env:ATOM_URL = 'http://你的-Core-主机:14558'
npm run verify
npm run verify -- --liner-notes
```

验证脚本通过现有 `/api/plugins/*` 接口检查菜单和封面匹配，通过 `/api/comments/*` 检查唱片内页的来源和两个标签页。报告写入 `artifacts/host-verification.json`。首次在线验证封面和唱片内页时，Core 需要能访问公共服务。

`node scripts/probe-services.mjs` 可单独诊断公共服务连通性和插件候选；它使用文档形状的 `splayer` 测试适配器，不代表真实 Core 的匹配结果。实际验收使用 `verify-host.mjs`。

详细实测见 [验证记录](docs/verification.md)。

## 发布与更新

三个脚本的 `@homepage` 指向本仓库，`@updateUrl` 指向 `main` 分支对应的 raw `.js` 文件。发布后可在 Atom 插件管理中检查并应用更新。

早期本地测试版没有声明更新地址，需要先使用上面的公开 URL 重新导入一次，后续即可检查更新。

维护时保持 `@updateUrl` 指向稳定的脚本地址。发布新版递增 `@version`、按需修改 `@changelog`，保持 `@id`、`@type` 不变。发布封面或唱片内页插件新版时，同步更新各自的 User-Agent 版本。

## API 和服务依据

- [Atom 插件总览](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/index.md)、[音源插件](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/source.md)、[控制插件](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/control.md)、[更新](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/update.md)。
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)、[搜索语法](https://musicbrainz.org/doc/MusicBrainz_API/Search)、[限流与客户端标识](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)。
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)。

无新增 PluginAction、Track 字段或 Core 路由；没有文件系统、媒体库数据库访问或 metadata 写入逻辑。插件私有缓存只通过公开的 `splayer.storage` 存储。
