/**
 * @file settings.js
 * @description 设置读写与默认值。经典脚本，content 与 background 共用。
 * 只保留三件事的配置：引擎（DeepSeek / Ollama / 自定义）、网页翻译、漫画翻译。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.settings) return;

  /** 引擎预设：三种类型都走 OpenAI 兼容协议，差别只在 baseUrl 与默认模型 */
  Transelle.ENGINE_PRESETS = {
    deepseek: {
      type: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      needsKey: true,
      hint: "官方 API，需要 Key。默认 deepseek-flash；视觉请填支持图片的模型名。",
    },
    hymt2: {
      type: "hymt2",
      name: "混元 Hy-MT2（腾讯 TokenHub）",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      model: "hy-mt2-pro",
      needsKey: true,
      hint: "翻译专用模型（30B-A3B），OpenAI 兼容；在腾讯云 TokenHub 控制台取 API Key。",
    },
    ollama: {
      type: "ollama",
      name: "Ollama（本地）",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5:7b",
      needsKey: false,
      hint: "本机 Ollama，默认端口 11434，无需 Key。视觉模型可用 llava / qwen2.5vl 等。",
    },
    custom: {
      type: "custom",
      name: "自定义（OpenAI 兼容）",
      baseUrl: "http://localhost:1234/v1",
      model: "",
      needsKey: true,
      hint: "LM Studio / llama.cpp / vLLM / 任意 OpenAI 兼容网关，填 baseUrl + 模型名。",
    },
  };

  const DEFAULT_SETTINGS = {
    version: 1,
    /** 引擎列表；id 为内部唯一键 */
    engines: [
      {
        id: "deepseek",
        type: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "",
        model: "deepseek-flash",
      },
    ],
    /** 网页翻译用哪个引擎 */
    engineId: "deepseek",
    /** 漫画翻译用哪个引擎；留空表示复用 engineId */
    visionEngineId: "",
    /** 漫画视觉模型名；留空表示复用该引擎的 model */
    visionModel: "",
    page: {
      autoTranslate: false, // 打开页面自动开始整页翻译
      mode: "bilingual", // bilingual=原文+译文对照；only=仅显示译文
      toLang: "zh-CN", // 目标语言
      highlight: false, // 是否给译文加浅色底纹，便于一眼分辨
      // 并发批次数（DeepSeek flash 账号级上限 2500，这里只是别把浏览器和网络打满）
      concurrency: 16,
      // 分流：正文（阅读主体）才交给 DeepSeek 精翻，边角（导航/页脚/侧栏等）交给免费机翻
      routing: {
        enabled: true,
        fast: "google", // 免费机翻服务商：google
      },
    },
    manga: {
      mode: "overlay", // overlay=嵌字；danmaku=侧栏弹幕；off=关闭（记住用户上次选择）
    },
    /** 用户自定义规则；与内置规则按 pattern 合并，用户规则优先 */
    rules: [],
    logLevel: "info",
    /** 本机种子（local-seed.json）是否已导入过；只自动生效一次 */
    seeded: false,
  };

  const clone = (v) => JSON.parse(JSON.stringify(v));

  const pickEngine = (settings, id) =>
    settings.engines.find((e) => e.id === id) || settings.engines[0] || null;

  Transelle.settings = {
    defaults: DEFAULT_SETTINGS,

    /** 合并默认值，兼容老版本存储里缺字段的情况 */
    normalize(raw) {
      const base = clone(DEFAULT_SETTINGS);
      if (!raw || typeof raw !== "object") return base;
      const merged = {
        ...base,
        ...raw,
        page: {
          ...base.page,
          ...(raw.page || {}),
          routing: { ...base.page.routing, ...((raw.page || {}).routing || {}) },
        },
        manga: { ...base.manga, ...(raw.manga || {}) },
        engines:
          Array.isArray(raw.engines) && raw.engines.length
            ? raw.engines
            : base.engines,
        rules: Array.isArray(raw.rules) ? raw.rules : [],
      };
      // 引擎字段补全：早期保存的条目可能缺 model / baseUrl
      merged.engines = merged.engines.map((e) => {
        const preset = Transelle.ENGINE_PRESETS[e.type] || Transelle.ENGINE_PRESETS.custom;
        return {
          id: e.id || preset.type,
          type: e.type || "custom",
          name: e.name || preset.name,
          baseUrl: e.baseUrl || preset.baseUrl,
          apiKey: e.apiKey || "",
          model: e.model || preset.model || "",
        };
      });
      if (!merged.engines.some((e) => e.id === merged.engineId)) {
        merged.engineId = merged.engines[0].id;
      }
      // 并发数钳到 1–64
      const c = Number(merged.page.concurrency);
      merged.page.concurrency = Number.isFinite(c) ? Math.min(64, Math.max(1, Math.round(c))) : 16;
      if (merged.visionEngineId || merged.visionEngineId === "") {
        // 空字符串是合法值（表示复用网页引擎）
        if (
          merged.visionEngineId &&
          !merged.engines.some((e) => e.id === merged.visionEngineId)
        ) {
          merged.visionEngineId = "";
        }
      }
      return merged;
    },

    async load() {
      const store = await chrome.storage.local.get(Transelle.STORAGE_KEY);
      return Transelle.settings.normalize(store[Transelle.STORAGE_KEY]);
    },

    async save(settings) {
      await chrome.storage.local.set({
        [Transelle.STORAGE_KEY]: Transelle.settings.normalize(settings),
      });
    },

    /** 只改一部分字段并落盘，返回最新设置 */
    async patch(partial) {
      const current = await Transelle.settings.load();
      const next = Transelle.settings.normalize({ ...current, ...partial });
      await Transelle.settings.save(next);
      return next;
    },

    /** 设置变化回调，返回取消订阅函数 */
    onChange(cb) {
      const handler = (changes, area) => {
        if (area !== "local" || !changes[Transelle.STORAGE_KEY]) return;
        cb(Transelle.settings.normalize(changes[Transelle.STORAGE_KEY].newValue));
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },

    /**
     * 解析出「网页翻译」要用的引擎配置。
     * @returns {Object|null} `{id, type, baseUrl, apiKey, model}` 或 null
     */
    resolveEngine(settings) {
      const engine = pickEngine(settings, settings.engineId);
      if (!engine) return null;
      return { ...engine };
    },

    /**
     * 解析出「漫画翻译」要用的引擎配置。视觉引擎留空时复用网页引擎，
     * 模型名留空时复用该引擎的默认模型。
     * @returns {Object|null}
     */
    resolveVisionEngine(settings) {
      const engine = pickEngine(
        settings,
        settings.visionEngineId || settings.engineId
      );
      if (!engine) return null;
      const resolved = { ...engine };
      if (settings.visionModel) resolved.model = settings.visionModel;
      return resolved;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
