/**
 * @file background.js
 * @description Service Worker。职责只有三件：持有引擎配置、代理所有网络请求、
 * 代理跨域取图。content 侧不接触 API Key，也不直接 fetch 外部服务。
 */
// settings.js 必须一起加载：Service Worker 要读引擎配置，少一个就会在启动时抛
// 「Cannot read properties of undefined」并静默失效。
importScripts(
  "./core/shared.js",
  "./core/settings.js",
  "./core/engines.js",
  "./core/seed.js"
);

const T = globalThis.Transelle;

T.settings.load()
  .then((s) => T.setLogLevel(s.logLevel))
  .catch(() => {});

T.settings.onChange((s) => T.setLogLevel(s.logLevel));

// 本机种子：把 local-seed.json 里的 Key 灌进设置。没有这个文件（例如从 GitHub
// 克隆的副本）就静默跳过，不影响任何功能。
T.seed
  .apply()
  .then(({ applied }) => {
    if (applied) T.log.info(`本机种子：已导入 ${applied} 个引擎的 Key`);
  })
  .catch(() => {});

/** ArrayBuffer → base64（Service Worker 里没有 FileReader，手工分块编码） */
const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/** 代理取图：绕开页面 CORS 限制，也避免把跨域图片画进 canvas 造成污染 */
const fetchImageAsDataUrl = async ({ url }) => {
  if (!url) throw new Error("缺少图片地址");
  const res = await fetch(url, { credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`取图失败 HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  const base64 = toBase64(await blob.arrayBuffer());
  return `data:${type};base64,${base64}`;
};

const handlers = {
  [T.MSG.TRANSLATE]: async ({ texts, toLang, rule }) => {
    const settings = await T.settings.load();
    const engine = T.settings.resolveEngine(settings);
    if (!engine) throw new Error("未配置翻译引擎");
    return T.engines.translate(engine, { texts, toLang, rule });
  },

  [T.MSG.VISION]: async ({ imageDataUrl, systemPrompt }) => {
    const settings = await T.settings.load();
    const engine = T.settings.resolveVisionEngine(settings);
    if (!engine) throw new Error("未配置视觉引擎");
    return T.engines.vision(engine, { imageDataUrl, systemPrompt });
  },

  [T.MSG.FETCH_IMAGE]: fetchImageAsDataUrl,

  [T.MSG.TEST_ENGINE]: async ({ engine }) => T.engines.test(engine),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  // 异步处理必须 return true 保持消息通道，否则响应会被丢弃
  Promise.resolve()
    .then(() => handler(message))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      T.log.error("消息处理失败:", message?.type, err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    });
  return true;
});
