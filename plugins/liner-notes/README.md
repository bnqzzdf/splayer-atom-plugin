# Liner Notes

`@id atom.liner-notes` · `@type source` · `@apiLevel 3`

在支持插件评论的 Atom 中导入并启用插件，打开歌曲评论，在右上角的来源下拉中选择 **唱片内页**。宿主用 `musicSearch` 匹配 MusicBrainz 录音，再用 `musicComment` 加载资料。歌曲需要有足够的元数据供宿主匹配，搜索候选附带录音时长及专辑信息。

| 评论标签 | 内容 |
| --- | --- |
| 热门 | 曲目或专辑的 Wikipedia 摘要、MusicBrainz 唱片档案和制作人员、Cover Art Archive 实体扫描 |
| 最新 | MusicBrainz 录音关联的发行版，按已知发行日期从新到旧排列 |

Wikipedia 摘要使用录音及其关联作品的词条链接。缺少曲目词条链接时，会查找专辑词条。通过 Wikidata 查找词条时优先使用界面语言，在中文和英文之间回退。实体扫描最多展示六张，优先使用封底、盘面或内页。

MusicBrainz 请求在插件内间隔至少 1100 毫秒，重复的并发查询会合并。搜索结果在内存缓存 10 分钟。唱片内页使用 `splayer.storage` 缓存已返回的资料，通常保留 7 天。录音不存在的结果保留 1 小时。各资料卡取决于曲目匹配及公共服务可用的数据，发行版列表以 MusicBrainz 录音查询返回的版本为准。

安装、本地托管与发布步骤见 [项目说明](../../README.md)。宿主契约见 [Atom 音源插件接口](https://github.com/bnqzzdf/splayer-atom/blob/dev/docs/plugins/source.md#musiccomment)。
