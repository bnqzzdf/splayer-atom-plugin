# 验证记录

验证日期：2026-09-30（Asia/Shanghai）。

## 环境与安装

- Atom：局域网测试环境，Core v1.1.3、Linux x64 / Node 24.18.0。
- Core commit：`e883d9e3b38bc71cfce3ffd03ef7174fdfb71093`；`sourceDirty: false`。
- 对照该 commit 的公开插件契约开发，未修改 Core 文件、HTTP 路由、Track 定义或匹配算法。
- 两个独立 `.js` 脚本通过远端专用临时目录的 loopback HTTP 服务和现有 `/api/plugins/install-url` 安装。最终都启用且 `ready`。
- 宿主验证脚本比较已安装 manifest 的 SHA1 与本地源码，确认验证的是当前脚本。

## 本地验证

`npm test`：10 项通过；`npm run check`：两个脚本语法检查通过。

覆盖中文/英文、多艺术家、特殊字符 URL、缺失字段、透传发行信息、忽略无时长录音、并发 MusicBrainz 请求间隔、请求合并、重载后持久化缓存、发行版/group/其他版本回退、正面封面选择、404 负缓存、暂时错误重试与无效图片 URL。

## 真实宿主验证

`node scripts/verify-host.mjs`：13 项通过。JSON 结果位于本地 `artifacts/host-verification.json`；运行产物与截图不随公开仓库上传。

| 检查 | 结果 |
| --- | --- |
| 两个插件注册、启用、源码 SHA1 | 通过 |
| MusicBrainz / Discogs / YouTube 三个菜单动作 | 返回正确 HTTPS 搜索地址 |
| 复制歌曲与专辑信息 | 返回正确 `copyText` 与提示 |
| 专辑缺失 | 仅提示，不返回复制文本 |
| The Beatles / Come Together / Abbey Road / 259s | 返回该专辑的 1200px CAA 封面 |
| Eagles / Hotel California / Hotel California / 390s | 返回该专辑的 1200px CAA 封面 |
| 不存在的曲名 | `{ ok: false }`，无封面 |
| Come Together 时长改为 10s | `{ ok: false }`，宿主时长门槛生效 |

初次联网查询 Abbey Road 约 5.93 秒，Hotel California 约 6.82 秒；同曲目内存缓存查询约 14–19ms。重新导入插件后，搜索重新联网而封面私有缓存仍命中，Abbey Road 约 1.24 秒返回。耗时是本次环境的观测值，非性能承诺。

实测暴露并修正的插件问题：默认 20 条 MusicBrainz 结果漏掉热门歌曲的原始录音；CAA JSON 重定向到 Archive 的冷请求超过 3 秒。最终默认搜索 100 条录音、封面单次请求最多 6.5 秒且整体预算 13.5 秒，仍遵守宿主既有期限。

## 页面验证与边界

- 插件管理中两个插件均显示“已就绪 / 已启用”；截图：`artifacts/plugins-installed.png`。
- 真实歌曲上下文菜单显示 Music Tools 子菜单及全部五项。
- 点击复制歌曲后，Atom 页面显示“已复制 / 已复制歌曲信息”。浏览器工具未读到系统剪贴板文本，因此系统剪贴板内容不计入已核实项；已核实处理器/API 的 `copyText` 返回值。
- 浏览器直接打开返回的 Abbey Road 图片，确认重定向后的图片已完成解码，实际尺寸为 1200 × 1200。
- 封面测试调用真实 Core 的 `match-cover`，经过宿主自己的候选匹配；未切换用户播放曲目。因此自动播放触发与全屏播放器最终显示未做完整端到端验证。
- 复杂古典曲名、多语言别名、实体发行版本精确识别及数据库未收录内容不在本轮样本覆盖内。
- 上述实测使用早期本地测试版，当时尚未设置公开分发与 `@updateUrl`。

已安装插件在临时托管服务关闭后继续工作：Atom 已复制脚本到自己的插件存储，运行时不依赖导入 URL。

## 公开发布准备（2026-11-23）

v1.0.1 补充公开仓库主页、稳定的 raw 更新地址和更新说明；插件功能保持初版行为。宿主实测结果仍对应 2026-09-30 的测试环境，不代表本次重新执行了远端宿主验证。

本次重新运行 `npm test`（10 项通过）和 `npm run check`（通过），并完成待提交文件的 `git diff --cached --check`。
