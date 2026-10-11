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
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
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
<!-- TODO：托管到 GitHub Pages 或任一公开 URL -->

> 本扩展不收集、不存储、不传输任何用户个人信息。翻译所需的网页文本与图片，仅由你的浏览器直接发往你在设置中自行选择的翻译服务，用于生成译文；扩展不保留这些内容，也不向任何其他第三方共享。API Key 与站点规则仅保存在本机浏览器存储中，不会上传。

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**
serena-sheng

**Contact Email**
<!-- TODO：填公开显示的联系邮箱 -->

**Support URL / Email**
https://github.com/serena-sheng/transelle/issues

**Homepage URL**
https://github.com/serena-sheng/transelle

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.1 | 2026-10-12 | 服务 worker 与内容脚本改用 async/await；popup 补 focus-visible 与 reduced-motion，命中区加大；加 440×280 促销图 | Draft |
| 1.0.0 | — | 初版 | — |

## Review Notes

### Known Issues / Limitations
- `<all_urls>` 与 `scripting` 属宽权限，会拉长审核。理由：网页/漫画翻译必须覆盖任意站点。
- 无远程代码：所有逻辑都在包内；翻译请求是数据（文本/图片），不是脚本。
- 内容脚本以 `document_idle` 注入，未使用 `eval`。

### Rejection History
| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
