/**
 * @file shared.js
 * @description 公共工具与消息协议。经典脚本（非 ESM），挂到 globalThis.Transelle 命名空间，
 * 这样 background(importScripts) 与 content_scripts(<script> 顺序加载) 都能复用同一份实现。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.__sharedReady) return;
  Transelle.__sharedReady = true;

  // --- 消息协议：content <-> background ---
  Transelle.MSG = {
    TRANSLATE: "transelle:translate", // 批量文本翻译
    VISION: "transelle:vision", // 视觉请求（漫画气泡）
    FETCH_IMAGE: "transelle:fetchImage", // 代理取图（规避 CORS / canvas 污染）
    TEST_ENGINE: "transelle:testEngine", // 设置页测试连接
    TRANSLATE_DELTA: "transelle:translateDelta", // 流式：背景逐条把译文推回内容脚本
    TRANSLATE_FAST: "transelle:translateFast", // 免费机翻（Google / Microsoft），用于边角内容
    GET_ACTIVE_TAB: "transelle:getActiveTab",
    TOGGLE_PAGE: "transelle:togglePage",
    PAGE_STATE: "transelle:pageState",
  };

  Transelle.STORAGE_KEY = "transelle.settings.v1";
  Transelle.MANGA_CACHE_KEY = "transelle.mangaCache.v1";

  // --- 日志 ---
  const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
  let currentLevel = LEVELS.info;

  Transelle.setLogLevel = (name) => {
    currentLevel = LEVELS[name] ?? LEVELS.info;
  };

  const emit = (level, args) => {
    if (LEVELS[level] > currentLevel) return;
    const tag = `[Transelle/${level}]`;
    if (level === "error") console.error(tag, ...args);
    else if (level === "warn") console.warn(tag, ...args);
    else console.log(tag, ...args);
  };

  Transelle.log = {
    error: (...a) => emit("error", a),
    warn: (...a) => emit("warn", a),
    info: (...a) => emit("info", a),
    debug: (...a) => emit("debug", a),
  };

  /** FNV-1a 32 位哈希：用于文本/图片缓存键，碰撞概率对本用途足够低 */
  Transelle.hash = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  };

  Transelle.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  Transelle.debounce = (fn, wait) => {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    };
  };

  /** 只处理 http/https 页面；浏览器内部页、扩展页一律跳过 */
  Transelle.isTranslatableUrl = (href) => {
    try {
      const url = new URL(href);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  /**
   * 站点规则 pattern 匹配：支持逗号/换行分隔多个模式，每个模式用 * 通配。
   * 语义与 kiss-translator 保持一致，便于把既有规则直接搬过来。
   */
  Transelle.matchPattern = (href, pattern) => {
    if (!pattern) return false;
    return String(pattern)
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .some((p) => Transelle.wildcardMatch(href, p));
  };

  Transelle.wildcardMatch = (s, p) => {
    if (!s || !p) return false;
    const pattern = "*" + p + "*";
    let si = 0;
    let pi = 0;
    let sRecord = -1;
    let pRecord = -1;
    while (si < s.length && pRecord < pattern.length) {
      if (pattern[pi] === "*") {
        pi++;
        sRecord = si;
        pRecord = pi;
      } else if (s[si] === pattern[pi]) {
        si++;
        pi++;
      } else if (sRecord + 1 < s.length) {
        sRecord++;
        si = sRecord;
        pi = pRecord;
      } else {
        return false;
      }
    }
    if (pi === pattern.length) return true;
    while (pattern[pi] === "*") pi++;
    return pi === pattern.length;
  };

  /**
   * 解析术语表：每行「原文,译文」，英文逗号分隔，只取前两段。
   * 定义在公共层是因为 content（站点规则）与 background（拼提示词）都要用。
   */
  Transelle.parseTerms = (text) => {
    const map = {};
    String(text || "")
      .split("\n")
      .forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = trimmed.indexOf(",");
        const term = (idx < 0 ? trimmed : trimmed.slice(0, idx)).trim();
        const target = idx < 0 ? "" : trimmed.slice(idx + 1).trim();
        if (term) {
          // 术语可能跨行重复定义，后者覆盖前者，便于用户单独修正某一条
          map[term] = target;
        }
      });
    return map;
  };

  /**
   * 是否以汉字为主（排除日文假名 / 韩文谚文）。
   * 用于把「中文互转」（简体 ↔ 各类繁体）分流到免费机翻，不走精翻引擎。
   */
  const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
  const KANA_RE = /[\u3040-\u30ff]/;
  const HANGUL_RE = /[\uac00-\ud7af]/;
  Transelle.isChinese = (text) => {
    const s = String(text || "");
    if (!HAN_RE.test(s)) return false;
    if (KANA_RE.test(s) || HANGUL_RE.test(s)) return false; // 日文/韩文不算中文
    const han = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    const latin = s.match(/[A-Za-z]/g)?.length || 0;
    return han >= 2 && han >= latin;
  };

  /** 折叠空白后比较两段文本是否相同（判断译文是否与原文一致，一致就不必注入） */
  Transelle.sameText = (a, b) =>
    String(a || "").replace(/\s+/g, " ").trim() ===
    String(b || "").replace(/\s+/g, " ").trim();

  /**
   * 向 background 发消息并解开 `{ok, data}` 包装。
   * 统一在这里抛错，调用方只需要 try/catch 一次。
   */
  Transelle.send = async (type, payload = {}) => {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (!res) {
      throw new Error("扩展后台无响应（扩展可能刚重载过，刷新页面即可）");
    }
    if (!res.ok) throw new Error(res.error || "未知错误");
    return res.data;
  };

  Transelle.escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  /** 判断节点是否在可编辑区域，避免动到输入框 */
  Transelle.isEditable = (node) => {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
