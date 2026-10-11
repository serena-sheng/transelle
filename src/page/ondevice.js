/**
 * @file ondevice.js
 * @description 浏览器内置的设备内翻译（Chrome 138+ 的 `Translator` API）。
 *
 * 特点：**不走网络、免费、内容不出本机**，延迟接近零。所以它优先于免费机翻端点。
 * 但它有两条硬约束，必须照做：
 *  1. 语言包按语种对下载，**未下载时 `create()` 会抛 NotAllowedError（需要用户手势）**
 *     → 未就绪就**回退**给免费机翻；下载入口放在设置页（那里有点击手势）。
 *  2. 同一个 translator 的调用是**顺序**的 → 这里逐条 await，不并发。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.onDevice) return;

  // 我们的短码 → BCP 47
  const MAP = { "zh-CN": "zh", "zh-TW": "zh-Hant", en: "en", ja: "ja", ko: "ko" };
  const bcp47 = (lang) => MAP[lang] || lang;
  const CANDIDATES = ["en", "ja", "ko", "zh-Hant"]; // 可能出现的中文以外的源 + 繁体中文

  const translators = new Map(); // "s->t" -> translator
  const availCache = new Map(); // "s->t" -> availability
  const deadPairs = new Set(); // create() 失败过的语种对：本页不再重试

  const supported = () => typeof self !== "undefined" && "Translator" in self;

  const availability = async (s, t) => {
    const key = `${s}->${t}`;
    if (availCache.has(key)) return availCache.get(key);
    let v = "unavailable";
    try {
      v = await self.Translator.availability({ sourceLanguage: s, targetLanguage: t });
    } catch {
      v = "unavailable";
    }
    availCache.set(key, v);
    return v;
  };

  /** 粗判这批文本的源语言（不依赖 LanguageDetector，因为它同样要下语言包） */
  const guessSource = (texts) => {
    const joined = texts.join(" ").slice(0, 400);
    if (Transelle.hasKana(joined)) return "ja";
    if (/[\uac00-\ud7af]/.test(joined)) return "ko";
    // 中文源一律当繁体处理：输出简体（已是简体的会被 sameText 判为无变化而跳过）
    if (Transelle.isChinese(joined)) return "zh-Hant";
    return "en";
  };

  const mark = (value) => {
    // 只在 <html> 上留一个状态标记，便于排查「这次到底走没走设备内翻译」
    try {
      document.documentElement.dataset.transelleOd = value;
    } catch {
      /* 忽略 */
    }
  };

  Transelle.onDevice = {
    supported,
    availability,
    bcp47,

    /**
     * 为这批文本挑一个「已就绪」的语种对。没有就返回 null —— 调用方回退到免费机翻。
     * @returns {Promise<{source:string,target:string}|null>}
     */
    async pick(texts, toLang) {
      if (!supported()) {
        mark("no-api"); // 诊断：这个上下文看不到 Translator
        return null;
      }
      const target = bcp47(toLang);
      const guess = guessSource(texts);
      const order = [guess, ...CANDIDATES.filter((c) => c !== guess)];
      const tried = [];
      for (const source of order) {
        if (source === target) continue;
        const key = `${source}->${target}`;
        if (deadPairs.has(key)) continue; // 之前创建失败过，别再试
        const av = await availability(source, target);
        tried.push(`${source}:${av}`);
        if (av === "available") return { source, target };
      }
      mark(tried.length ? `none(${tried.join(",")})` : "none");
      return null;
    },

    /** 顺序翻译（该 API 本身顺序），返回与输入等长的数组 */
    async translate(texts, { source, target }) {
      const key = `${source}->${target}`;
      let translator = translators.get(key);
      if (!translator) {
        try {
          translator = await self.Translator.create({
            sourceLanguage: source,
            targetLanguage: target,
          });
        } catch (err) {
          deadPairs.add(key); // 这对语种在这个浏览器上用不了，本页别再试
          mark(`fail:${key}`);
          throw err;
        }
        translators.set(key, translator);
      }
      const out = [];
      for (const text of texts) out.push(await translator.translate(text));
      mark(`ok:${key}`);
      return out;
    },

    /**
     * 带用户手势地把某个语种对的语言包下下来（只能在设置页那种有手势的上下文调用）。
     */
    async download(source, target, onProgress) {
      if (!supported()) throw new Error("这台浏览器不支持设备内置翻译（需要 Chrome 138+ 桌面版）");
      const translator = await self.Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded));
        },
      });
      translators.set(`${source}->${target}`, translator);
      availCache.delete(`${source}->${target}`);
      return true;
    },
  };

  // 起始状态：这个上下文（内容脚本的隔离世界）看不看得到 Translator
  mark(supported() ? "ready" : "no-api");
})(typeof globalThis !== "undefined" ? globalThis : self);
