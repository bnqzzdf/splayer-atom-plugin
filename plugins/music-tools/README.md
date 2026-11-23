# Music Tools

`@id atom.music-tools` · `@type control` · `@apiLevel 2` · `@grant ui`

安装后，歌曲的上下文菜单中出现 **Music Tools** 子菜单，对所有来源的歌曲生效：

| 操作 | 行为 |
| --- | --- |
| 在 MusicBrainz 中搜索 | 以曲名和各艺术家的独立条件搜索 recording |
| 在 Discogs 中搜索 | 搜索“艺术家 曲名” |
| 在 YouTube 中搜索 | 搜索“艺术家 曲名” |
| 复制 艺术家 - 曲名 | 例如 `The Beatles - Come Together` |
| 复制专辑信息 | 例如 `The Beatles - Abbey Road` |

网页操作返回 `openUrl`，复制操作返回 `copyText` 和 `toast`，由宿主执行。插件本身不联网，不控制播放，不订阅播放事件，也不使用 DOM 或剪贴板 API。

多位艺术家去重后以 ` / ` 连接；空白和换行归一化。无艺术家时只复制曲名；无专辑时提示缺少信息，不覆盖剪贴板。所有网页 URL 都进行参数编码，MusicBrainz 条件中的引号与反斜杠经过转义。菜单和提示根据宿主语言选择中文或英文。

HTTP 网页是否能实际写入系统剪贴板，由 Atom 前端和浏览器权限决定；插件仅提供宿主约定的文本。外链的打开方式同样由宿主负责。

安装与发版见 [项目说明](../../README.md)。
