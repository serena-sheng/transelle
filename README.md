# 翻译娘MARI · Transelle

网页整页翻译 + 漫画图片翻译的 Chrome 扩展（Manifest V3）。

只保留真正用得上的三件事：**网页翻译**、**漫画翻译**、**DeepSeek 与本地模型引擎**，
另外保留一项别处买不到的能力——**针对特定内容类型特化译法**的站点规则。
没有构建步骤，没有打包器，加载即用。

---

## 为什么重做

此前的版本基于 kiss-translator 的 fork（约 9 万行）。漫画模式在该分支上反复失效，
根因是 fork 的规则预设被存进了"订阅缓存"槽位，每次与上游同步订阅就被覆盖掉。

与其在一个陌生的大代码库里继续打补丁，不如把想要的部分按自己的理解重写。
本仓库就是那次重写的结果：**代码量小到可以完整读懂**，站点规则写死在源码里，
不依赖任何远程订阅，因此不存在"被同步覆盖"这一类问题。

---

## 功能

### 网页翻译

- 整页正文替换，按 `document_idle` 自动注入
- 两种显示模式：**双语对照**（原文下方插入译文）／**仅译文**（隐藏原文）
- 可选的浅色底纹高亮，一眼分清哪句是译文
- 批量提交（每批 20 段）＋ 失败逐条降级；单条失败不影响整页
- 页面滚动预取 + MutationObserver 兜底懒加载内容
- 译文缓存按文本哈希去重，同一段落不重复计费

### 漫画翻译

自动识别页面里够大的图片（短边 ≥ 300px），走视觉模型拿到气泡坐标与译文，
再按气泡位置把译文嵌回图上。三种模式，点击图上悬浮按钮循环切换：

| 按钮 | 模式 | 效果 |
| --- | --- | --- |
| **漫** | 嵌字 | 译文直接覆盖在气泡位置 |
| **幕** | 弹幕侧栏 | 图片压窄，左右腾出栏位，译文按原文纵向位置贴在栏里；栏内堆满则转为可滚动 |
| **原** | 关闭 | 还原原图，移除所有覆盖层 |

弹幕侧栏是本项目原创的功能：左右分栏按气泡水平中心决定，两栏各自按锚点排序后顺排，
既不重叠，又尽量贴着原文的纵向位置。栏内溢出时该栏转为可滚动，并在两端给出渐隐滚动提示；
每条译文在栏的靠图一侧有一条细线，标出它对应的原文纵向位置。

其他细节：请求前把图缩到最宽 1300px 再送模型（省 token、省时间），
坐标按归一化值处理并乘以实际发送尺寸，超出画布或过小的框会被丢弃。

### 引擎

三种类型，全部走 OpenAI 兼容的 `/chat/completions`，接口层只有一份实现：

| 类型 | 默认地址 | 默认模型 | 需要 Key |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 是 |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:7b` | 否 |
| 自定义（OpenAI 兼容） | `http://localhost:1234/v1` | 自行填写 | 视网关而定 |

**本地模型两种都支持**：Ollama 与任意 OpenAI 兼容网关（LM Studio / llama.cpp / vLLM 等）
是并列的两个预设，填个 baseUrl 就能用，不是二选一。

网页翻译与漫画翻译可以分别指定引擎；漫画视觉模型名留空则复用该引擎的默认模型。

### 站点特化

内置两组规则，直接写在 `src/core/rules.js` 里：

- **代码托管**（`github.com`）：技术术语表，避免把 API / commit / branch 译成奇怪的中文
- **财经新闻**（reuters / bloomberg / ft / economist 等）：金融术语表与新闻语气

一条规则包含这些字段：

```js
{
  pattern: "github.com",  // 逗号或换行分隔多个模式，支持 * 通配
  pageEnabled: true,      // 是否做整页翻译
  mangaEnabled: false,    // 是否做漫画翻译
  selector: "",           // 待翻译元素，留空用默认
  ignoreSelector: "",     // 忽略元素，留空用默认
  terms: "原文,译文\n...", // 术语表，一行一条
  prompt: ""              // 追加到系统提示词的补充要求
}
```

匹配语义与 kiss-translator 保持一致（隐式前后加 `*`，即按子串通配），
方便把既有规则直接搬过来。

**用户规则**在设置页「站点特化」里维护，按字段覆盖内置规则：
你只在用户规则里填了 `terms`，那么内置规则的 `mangaEnabled`、`prompt` 等仍然生效。

---

## 安装

1. 打开 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（含 `manifest.json` 的那一层）
4. 建议把扩展详情页里的「允许访问文件网址」按需打开，否则 `file://` 页面不会被翻译

Ego 等其他 Chromium 内核浏览器同理，进入其扩展管理页加载本目录即可。

## 配置

右键扩展图标 →「选项」，或从弹窗点「打开设置」：

1. **引擎**：至少配一个。填 DeepSeek 的 API Key，或指向本机 Ollama / 任意兼容网关
2. **网页翻译**：选显示模式、目标语言，勾选「打开页面自动开始」可省去每次手动点
3. **漫画翻译**：选视觉引擎与模型；不指定就复用网页翻译的引擎
4. **站点特化**：内置规则只读展示，下方可增删自己的规则

设置页每个引擎卡片都有「测试连接」，会真发一次请求，失败时给出可读原因
（如 401 会提示 Key 有问题），不会静默失败。

---

## Key 从哪来

Key 有两处落点，职责不同：

| 落点 | 作用 | 是否入库 |
| --- | --- | --- |
| `local-seed.json`（扩展根目录） | 让扩展开箱即用，启动时自动灌进设置 | ❌ 已 gitignore |
| KeePassXC 保险库 `agent-mind/DEEPSEEK_API_KEY` | 长期归档，跨设备同步（保险库本身加密） | ✅ 存的是价值，不是明文 |

**本机已经复用 omp 在用的那把 DeepSeek Key**，来源是 `~/.omp/agent/agent.db`
的 `deepseek` 凭据，不需要再申请第二把。

种子的生成与导入：

- 首次启动时 `background.js` 读 `local-seed.json`，把 Key 灌进对应引擎并打上
  `seeded` 标记；**只自动生效一次**，你后来手动清空 Key 不会被灌回来
- 设置页「引擎」面板右上角有「从本机种子导入 Key」，可随时强制重新导入
- 扩展目录下没有 `local-seed.json`（例如从 GitHub 克隆的副本）时，一切照旧，
  手动填 Key 即可——这个文件是私密的、不随仓库分发

把 omp 的 Key 归档进保险库（**需要你自己跑，主密码只在你的终端里输入一次**）：

```bash
bash tools/store-key-in-vault.sh
```

脚本会从 omp 凭据库取 Key，写进保险库 `agent-mind/DEEPSEEK_API_KEY`，
**写完回读比对**，不一致就报错而不是假装成功。之后可跑
`agent-mind/tools/sync-secrets.sh` 刷新本机 `secrets.env`。

---

## 目录结构

```
manifest.json            MV3 清单
icons/                   图标（16 / 32 / 48 / 128）
local-seed.json          本机私密种子（含 Key，gitignore，不进仓库）
src/
  background.js          Service Worker：代理请求、图片取回、base64 编码
  content.js             内容脚本入口：装配设置与规则，响应弹窗指令
  core/
    shared.js            消息协议、存储键、哈希、URL 通配、术语解析、日志
    settings.js          默认值、规范化、读写、引擎解析
    rules.js             内置站点规则 + 用户规则合并
    engines.js           统一 OpenAI 兼容调用（文本 / 视觉 / 连接测试）
    seed.js              本机种子 → 设置的导入（只生效一次）
  page/
    collector.js         挑出待翻译文本节点
    renderer.js          插入译文、双语/仅译文切换、页内提示
    pageTranslator.js    批量调度、缓存、MutationObserver
  manga/
    visionPrompt.js      视觉提示词、坐标归一化与校验
    overlay.js           嵌字层 + 弹幕侧栏（含三态切换按钮）
    mangaTranslator.js   图片队列、缩放、缓存、模式循环
options/
  options.html/.css/.js  设置页
  popup.html/.js         工具栏弹窗
tools/
  store-key-in-vault.sh  把 omp 的 Key 归档进 KeePassXC 保险库（回读校验）
```

代码是**经典脚本**（非 ESM），统一挂在 `globalThis.Transelle` 命名空间下，
同一份 `core/` 既被 `importScripts` 引入 Service Worker，也被 `<script>` 引入内容脚本。

---

## 隐私

- API Key 只存在本机 `chrome.storage.local`，不随扩展分发
- `local-seed.json` 内含明文 Key，权限 600 且被 `.gitignore` 排除，**任何情况下都不提交**
- 仓库全文不含任何 Key；`tools/` 里的脚本只从本机凭据读取，不内嵌值
- 除你配置的模型接口外，扩展不向任何第三方发送数据
- 漫画图片经由后台脚本取回（规避跨域与 canvas 污染），图片本身只发给你自己配置的模型接口

---

## 已知限制

- 漫画翻译的图像坐标由视觉模型给出，模型能力直接决定效果；建议用支持图片输入的模型
- 弹幕侧栏需要图片所在容器有足够宽度；容器过窄时侧栏宽度会自动收紧，以保证图片不被挤出容器
- 整页翻译对纯 canvas / 图片渲染的正文无能为力，这是 DOM 文本替换方案的固有边界

---

## 开发

无构建步骤，改完源码在扩展管理页点「重新加载」即可。

各文件均可单独做语法检查：

```bash
for f in $(find src options -name "*.js"); do node --check "$f"; done
```
