# Chrome Web Store Listing — 翻译娘MARI (Transelle)

> Last Updated: 2026-10-12

## Store Listing

**Extension Name**
翻译娘MARI

**Short Description**
网页整页翻译 + 漫画图片翻译（嵌字 / 弹幕侧栏），支持站点特化规则与自定义引擎。

**Detailed Description**
把网页和漫画翻译成你要的语言，就地显示，不用整页跳转。

整页翻译：点一下，当前页面的正文被翻译并与原文对照显示；可以随时还原。

漫画翻译：识别页面上的漫画图片，直接在图内嵌字，或在侧栏以弹幕形式逐句浮现，适合追更。

站点特化：可以为不同网站保存各自的语言、规则与引擎偏好，切站即切规则。

引擎：支持 DeepSeek 与本地 / 自建模型引擎，API Key 只保存在本机，不经第三方服务器中转。

用法：安装后在设置里填入引擎与 API Key，打开要翻译的页面，点工具栏图标选择「翻译本页」或漫画模式。

隐私：翻译文本会由你的浏览器直接发往你在设置里选择的翻译服务，用于生成译文。扩展自身不收集、不存储、不中转你的任何数据；Key 仅存于本机。

反馈与支持见下方链接。

**Category**
Productivity

**Single Purpose**
把网页正文与漫画图片翻译成目标语言，并在页面内就地显示。

**Primary Language**
中文（简体）

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready（设置页·引擎） | `store/screenshot-01-options.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready（设置页·漫画） | `store/screenshot-02-manga.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready（工具栏面板） | `store/screenshot-03-popup.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `store/promo-440x280.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
- 截图 1：整页翻译对比效果（原文 + 译文对照）。
- 截图 2：漫画嵌字效果。
- 截图 3（建议）：设置页的引擎与站点规则。
- 尺寸 1280×800，直角满幅。

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | 保存引擎配置、API Key、站点规则与语言偏好，供翻译功能使用。 |
| `scripting` | permissions | 向当前页面注入翻译脚本、渲染译文与漫画嵌字。 |
| `activeTab` | permissions | 仅在你点击扩展图标时，访问当前标签页并对其执行翻译。 |
| `<all_urls>` | host_permissions | 网页翻译需在任意站点工作；同时用于代理读取跨域图片以完成漫画翻译。 |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | Yes | Yes | 待翻译的网页文本 / 漫画图片会发往用户自己配置的翻译服务以生成译文 | 仅发往用户所选翻译服务，不向其他方共享 |

说明：扩展本身不收集数据。待翻译内容由浏览器直接发往**用户自行配置**的翻译服务（如 DeepSeek 或本地模型），是否发生传输由用户决定；扩展不经手、不存储、不中转。

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://serena-sheng.github.io/chrome-ext-privacy/transelle.html

> 本扩展不收集、不存储、不传输任何用户个人信息。翻译所需的网页文本与图片，仅由你的浏览器直接发往你在设置中自行选择的翻译服务，用于生成译文；扩展不保留这些内容，也不向任何其他第三方共享。API Key 与站点规则仅保存在本机浏览器存储中，不会上传。

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**
serena-sheng

**Contact Email**
serenaamphistritesheng@outlook.com

**Support URL / Email**
https://github.com/serena-sheng/transelle/issues

**Homepage URL**
https://github.com/serena-sheng/transelle

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.9.0 | 2026-10-12 | 接入**浏览器内置设备内翻译**（Chrome 138+ `Translator` API）作为边角内容的可选机翻通道：不走网络、免费、内容不出本机；语言包未就绪/创建失败自动回退 Google（带负缓存，不重复重试）。设置页新增「机翻服务商」与「下载语言包」（首次需用户手势）。**默认仍用 Google**——本机浏览器拿不到可用模型（`NotSupportedError`） | Draft |
| 1.8.0 | 2026-10-12 | 新增**混元 Hy-MT2**（腾讯 TokenHub）引擎预设：翻译专用模型、OpenAI 兼容，填 Key 即用；不必本机跑模型 | Draft |
| 1.7.0 | 2026-10-12 | 并发可调：设置页新增「并发批次数」（1–64，默认 16；原为固定 6）。DeepSeek flash 的账号级并发上限是 2500，远未触及；免费机翻侧并发提到 8。限流重试从 1 次加到 2 次（带退避） | Draft |
| 1.6.0 | 2026-10-12 | 外部设置通用化为**分语种**（`locales.js`）：日语按原样；新增**英语成人向**一组（站点/片商保留原文、常见女优名、Pornhub / XVideos 类站点的标签术语），**只在内容判定为成人向时启用**——普通英文页不会白塞术语表。判定词可用 `markers` 补充 | Draft |
| 1.5.0 | 2026-10-12 | 日语外部配置扩充到**七份共存**（基础 / 术语 / 角色名 / 常见人名 / 成人术语 / 女优与漫画家 / 成人作品名），约 800 条词条；合并逻辑不变，缺文件照常工作 | Draft |
| 1.4.0 | 2026-10-12 | 日语外部设置改为**多份共存**（`local-ja.json` / `-terms` / `-names` / `-adult`，按序合并，另支持 `imports` 引任意文件）；新增**假名 → 罗马音**兜底：强制重译后仍残留的假名（生僻片假名、日语中无意义的拼合）转为罗马音呈现，本地换算、不花 token | Draft |
| 1.3.0 | 2026-10-12 | 新增**日语 / 二次元外部设置**（`local-ja.json`，不入库、不进发布包）：检测到日文假名时，自动附加日语专用提示词与术语表，要求全文中文化、不残留假名；若译文仍夹带假名，**只对那几条做一次强制重译**。本地文件缺失时行为不变 | Draft |
| 1.2.1 | 2026-10-12 | **修复假译文**：机翻端点对「无需翻译」的输入常只改标点（全角↔半角），原比较只看空白，会把这种与原文实质相同的「译文」注入页面；改为忽略空白的**同时忽略标点**再比较，并补齐「缓存命中」这条路径。粤语页面上不再出现无意义的重复行，粤语句子由免费机翻正常转成普通话 | Draft |
| 1.2.0 | 2026-10-12 | 新增**中文互转规则**：目标语言为中文时，简体 ↔ 各类繁体一律走免费机翻并统一输出简体，不走 DeepSeek；已是简体的段落直接跳过（不请求、不注入）。中文识别排除日文假名与韩文 | Draft |
| 1.1.1 | 2026-10-12 | **修复漏翻**：收集器原先只认一份写死的标签白名单，`div` / `span` / `a` / `td` / `section` 等里的正文被整片跳过（现代 div 排版站点尤甚）。改为遍历全部文本节点 + 块级祖先过滤，并跳过隐藏（`display:none` / `aria-hidden`）、代码与脚本内容。同时修好行内元素（`<b>` 等）内文本漏翻 | Draft |
| 1.1.0 | 2026-10-12 | 新增**智能分流**：按阅读正文式权重把正文交给 DeepSeek 精翻、边角交给免费机翻（Google），降低 DeepSeek 文本量；模型默认统一为 `deepseek-flash`；设置页加分流开关 | Draft |
| 1.0.3 | 2026-10-12 | 网页翻译改为**流式**（SSE）：边生成边逐条注入，首句译文百毫秒级出现；流式不可用时自动回退非流式整批。实测（假引擎，单条 200ms）首句 85ms、整页 2.5s | Draft |
| 1.0.2 | 2026-10-12 | 网页翻译改为**并发批量**（每批 10 段、最多 6 批并飞）：整页耗时从「批数 × 单批」降到接近单批；新增页面内实时进度胶囊（`翻译中 x/y`）；每段译好即注入，不再等整页；取消即时生效（在飞批次作废）；引擎请求加 429/5xx 一次退避重试 | Draft |
| 1.0.1 | 2026-10-12 | 服务 worker 与内容脚本改用 async/await；popup 补 focus-visible 与 reduced-motion，命中区加大；**移除全部成人向内容（站点规则 / 术语表 / 提示词）**；加 440×280 促销图与 3 张 1280×800 截图 | Draft |
| 1.0.0 | — | 初版 | — |

## Review Notes

### Known Issues / Limitations
- `<all_urls>` 与 `scripting` 属宽权限，会拉长审核。理由：网页/漫画翻译必须覆盖任意站点。
- 无远程代码：所有逻辑都在包内；翻译请求是数据（文本/图片），不是脚本。
- 内容脚本以 `document_idle` 注入，未使用 `eval`。
- 内容合规：2026-10-12 已移除全部成人向内容——成人站点内置规则、露骨术语表、成人向提示词均已删除，`visionPrompt` 中的露骨措辞一并改为中性表述。当前版本不含任何成人内容，无「成熟内容」标记需求。

### Rejection History
| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
