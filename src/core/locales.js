/**
 * @file locales.js
 * @description 分语种的**外部注入设置**：每种语言一组配置文件，放在扩展根目录，
 * **不入库、不进发布包**——只有本机存在时才生效；商店安装的副本拿不到它们。
 *
 * 每种语言按下面的顺序合并（后面的覆盖前面的同名词条）：
 *
 * 日语（出现假名时启用）
 *   local-ja.json / -terms / -names / -people / -adult / -adult-people / -adult-works
 *   → 另带「假名 → 罗马音」兜底（romaji）
 *
 * 英语（**只在成人向内容上启用**，避免给普通英文页白塞术语表）
 *   local-en.json / -terms / -adult
 *
 * 任何一份都可以用 `"imports": ["别的文件.json"]` 再引入任意命名；也可以用
 * `"markers": "词a,词b"` 给「是不是成人内容是」的判定补词。
 *
 * 每份文件形状：
 * ```json
 * { "enabled": true, "prompt": "…补充要求…", "terms": "原文,译文\n…" }
 * ```
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.locales) return;

  // —— 英语成人内容的判定词 ——
  // 强信号：命中一个就算（站点名、明示词）
  const STRONG = /\b(porn|porno|pornhub|xvideos|xhamster|xnxx|redtube|youporn|spankbang|onlyfans|manyvids|chaturbate|stripchat|bongacams|ebravo|nsfw|xxx|hentai)\b/i;
  // 弱信号：一条标签里常常只出现一个，要求整批命中 ≥2 个不同词才算
  const WEAK = [
    "sex", "sexual", "nude", "naked", "fuck", "fucking", "cum", "cumshot", "dick", "cock",
    "pussy", "boobs", "tits", "anal", "blowjob", "handjob", "milf", "lesbian", "gay", "orgy",
    "orgasm", "creampie", "bdsm", "fetish", "escort", "camgirl", "nipple", "penis", "vagina",
    "erotic", "kinky", "threesome", "gangbang", "masturbation", "pornstar", "stripper", "squirt",
    "deepthroat", "bukkake", "gangbang", "amateur", "mature", "ebony", "latina", "bbw",
  ];

  const LOCALES = [
    {
      id: "ja",
      romaji: true,
      files: [
        "local-ja.json",
        "local-ja-terms.json",
        "local-ja-names.json",
        "local-ja-people.json",
        "local-ja-adult.json",
        "local-ja-adult-people.json",
        "local-ja-adult-works.json",
      ],
      /** @param {string[]} texts */
      match: (texts) => texts.some((t) => Transelle.hasKana(t)),
    },
    {
      id: "en",
      romaji: false,
      files: ["local-en.json", "local-en-terms.json", "local-en-adult.json"],
      match: (texts) => isAdultEnglish(texts),
    },
  ];

  /** 本批（或这段文字）像不像英语的成人内容 */
  function isAdultEnglish(texts) {
    const joined = (Array.isArray(texts) ? texts.join(" ") : String(texts || "")).slice(0, 200000);
    if (!joined) return false;
    if (STRONG.test(joined)) return true;
    const extra = extraMarkers();
    if (extra && extra.test(joined)) return true;
    let hits = 0;
    const seen = new Set();
    for (const w of WEAK) {
      if (seen.has(w)) continue;
      seen.add(w);
      if (new RegExp(`\\b${w}\\b`, "i").test(joined)) {
        hits++;
        if (hits >= 2) return true;
      }
    }
    return false;
  }

  // 各配置文件里 `markers` 字段补充的判定词（出现一次就够）
  let extraCache;
  function extraMarkers() {
    if (extraCache === undefined) return null;
    return extraCache;
  }

  const cache = new Map(); // id -> 合并结果（或 null）

  const readOne = async (name) => {
    try {
      const res = await fetch(chrome.runtime.getURL(name), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object" || data.enabled === false) return null;
      return data;
    } catch {
      return null; // 文件不存在（商店安装的副本）就静默跳过
    }
  };

  const loadLocale = async (locale) => {
    const parts = [];
    const seen = new Set();
    const queue = [...locale.files];
    while (queue.length) {
      const name = queue.shift();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const data = await readOne(name);
      if (!data) continue;
      parts.push(data);
      if (Array.isArray(data.imports)) {
        data.imports.forEach((extra) => {
          if (typeof extra === "string" && extra.endsWith(".json")) queue.push(extra);
        });
      }
    }
    if (!parts.length) return null;

    let romaji = !!locale.romaji;
    const extra = [];
    for (const p of parts) {
      if (typeof p.romaji === "boolean") romaji = p.romaji;
      if (typeof p.markers === "string" && p.markers.trim()) extra.push(p.markers);
    }
    if (extra.length) {
      const words = extra
        .join(",")
        .split(/[,\n]/)
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (words.length) extraCache = new RegExp(`\\b(${words.join("|")})\\b`, "i");
    }

    return {
      id: locale.id,
      romaji,
      files: [...seen],
      prompt: parts.map((p) => String(p.prompt || "")).filter(Boolean).join("\n\n"),
      terms: parts.map((p) => String(p.terms || "")).filter(Boolean).join("\n"),
    };
  };

  Transelle.locales = {
    list: LOCALES.map((l) => ({ id: l.id, files: [...l.files] })),

    /** 取某一语言的合并设置（没有对应文件时返回 null） */
    async get(id) {
      if (!cache.has(id)) {
        const locale = LOCALES.find((l) => l.id === id);
        cache.set(id, locale ? await loadLocale(locale) : null);
      }
      return cache.get(id);
    },

    /**
     * 本批文本命中了哪些语言配置。
     * @param {string[]} texts
     * @returns {Promise<Array<{id:string,prompt:string,terms:string,romaji:boolean}>>}
     */
    async activeFor(texts) {
      const out = [];
      for (const locale of LOCALES) {
        // 先加载（只读本地文件、结果缓存），这样配置里的 markers 判定词才能生效
        const cfg = await this.get(locale.id);
        if (cfg && locale.match(texts)) out.push(cfg);
      }
      return out;
    },

    /** 忘掉缓存，下次重新读文件（改完配置后可调用） */
    reset() {
      cache.clear();
      extraCache = undefined;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
