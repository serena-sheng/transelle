/**
 * @file engines.js
 * @description 翻译引擎层。DeepSeek / Ollama / 自定义 三者都走 OpenAI 兼容的
 * `/chat/completions`，差别只在 baseUrl、Key 与模型名，因此共用一套请求实现。
 *
 * 只在 background 里运行（importScripts 加载），content 侧一律通过消息调用，
 * 这样既能绕开页面 CSP，也不会把 Key 暴露给页面上下文。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.engines) return;

  const DEFAULT_TEXT_TIMEOUT = 60000;
  const DEFAULT_VISION_TIMEOUT = 120000;
  // 并发请求下 429 / 网关抖动更常见：退避重试一次，别让整批译文白白丢掉
  const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  /** baseUrl 归一化：允许用户填到 /v1，也允许直接填完整的 /chat/completions */
  const endpointOf = (baseUrl) => {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("引擎未配置 baseUrl");
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  };

  const buildHeaders = (engine) => {
    const headers = { "Content-Type": "application/json" };
    const key = String(engine.apiKey || "").trim();
    // Ollama 通常不需要 Key；带上空的 Authorization 反而会被某些网关拒绝
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  };

  const readError = async (res) => {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    const short = detail.slice(0, 300);
    return new Error(`HTTP ${res.status}${short ? ` - ${short}` : ""}`);
  };

  /**
   * 发起一次 chat 请求。
   * @param {Object} engine `{type, baseUrl, apiKey, model}`
   * @param {Array} messages OpenAI 格式消息
   * @param {Object} [opts]
   * @param {number} [opts.timeout] 超时毫秒
   * @param {number} [opts.maxTokens]
   * @param {number} [opts.temperature]
   * @returns {Promise<string>} 模型回复的纯文本
   */
  const chat = async (engine, messages, opts = {}) => {
    const {
      timeout = DEFAULT_TEXT_TIMEOUT,
      maxTokens = 4096,
      temperature = 0.3,
    } = opts;

    if (!engine || !engine.model) throw new Error("引擎未配置模型名");

    let res;
    // 至多两次尝试：首次 + 一次退避重试（仅针对限流/网关类错误）
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        res = await fetch(endpointOf(engine.baseUrl), {
          method: "POST",
          headers: buildHeaders(engine),
          body: JSON.stringify({
            model: engine.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err?.name === "AbortError") {
          throw new Error(`请求超时（${Math.round(timeout / 1000)}s）`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt >= 2) break;
      await Transelle.sleep(600 * (attempt + 1));
    }

    if (!res.ok) throw await readError(res);

    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("引擎返回内容为空或格式不符（期望 OpenAI 兼容格式）");
    }
    return content;
  };

  /**
   * 增量解析「JSON 字符串数组」的流。模型的 token 陆续到达，每凑齐一个完整的
   * 字符串元素就回调一次 onItem(index, text)，让界面不必等整批生成完。
   * 转义、\uXXXX、以及被切成两半的元素都能正确处理（没凑齐就等下一块）。
   * @param {(index: number, text: string) => void} onItem
   */
  const createArrayStreamParser = (onItem) => {
    let buf = "";
    let i = 0; // 解析游标
    let count = 0; // 已产出的元素个数
    let started = false; // 是否已找到起始的 '['
    const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

    const pump = () => {
      for (;;) {
        while (i < buf.length && (buf[i] === " " || buf[i] === "\n" || buf[i] === "\r" || buf[i] === "\t" || buf[i] === ",")) i++;
        if (i >= buf.length) return;
        if (buf[i] === "]") return;
        if (buf[i] !== '"') {
          i++; // 容错：跳过意外字符（围栏符号等）
          continue;
        }
        let j = i + 1;
        let out = "";
        let closed = false;
        for (; j < buf.length; j++) {
          const c = buf[j];
          if (c === "\\") {
            const n = buf[j + 1];
            if (n === undefined) break; // 转义被切断，等下一块
            if (n === "u") {
              const hex = buf.slice(j + 2, j + 6);
              if (hex.length < 4) break; // \uXXXX 未凑齐
              out += String.fromCharCode(parseInt(hex, 16));
              j += 5;
            } else {
              out += ESCAPES[n] ?? n;
              j += 1;
            }
            continue;
          }
          if (c === '"') {
            closed = true;
            j += 1;
            break;
          }
          out += c;
        }
        if (!closed) return; // 元素没收完，等下一块（下次从这里重算）
        onItem(count++, out);
        i = j;
      }
    };

    return {
      push(chunk) {
        buf += chunk;
        if (!started) {
          const b = buf.indexOf("[");
          if (b < 0) return;
          started = true;
          i = b + 1;
        }
        pump();
      },
    };
  };

  /**
   * 流式 chat：逐块读 SSE，累积正文；若给了 onItem，则边收边增量解析数组。
   * @returns {Promise<string>} 完整回复正文（与非流式一致的后续处理）
   */
  const chatStream = async (engine, messages, opts = {}, onItem) => {
    const { timeout = DEFAULT_TEXT_TIMEOUT, maxTokens = 4096, temperature = 0.3 } = opts;
    if (!engine || !engine.model) throw new Error("引擎未配置模型名");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(endpointOf(engine.baseUrl), {
        method: "POST",
        headers: buildHeaders(engine),
        body: JSON.stringify({
          model: engine.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw new Error(`请求超时（${Math.round(timeout / 1000)}s）`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw await readError(res);
    if (!res.body) throw new Error("该引擎不支持流式响应");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = onItem ? createArrayStreamParser(onItem) : null;
    let content = "";
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            content += delta;
            parser?.push(delta);
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
    return content;
  };

  // --- 免费机翻（Google gtx 端点）：边角内容走这里，不消耗 DeepSeek 配额 ---
  const GOOGLE_T = "https://translate.googleapis.com/translate_a/t";

  /**
   * 免费机翻。Google 的 gtx `/translate_a/t` 支持一次 POST 多条 `q`，
   * 并按输入顺序返回等长的 `[[译文, 检测语言], ...]`。
   * @param {Object} params
   * @param {string[]} params.texts
   * @param {string} [params.toLang]
   * @param {string} [params.provider] 目前仅 "google"
   * @returns {Promise<string[]>} 与输入等长的译文（失败位置保留原文）
   */
  const fastTranslate = async ({ texts = [], toLang = "zh-CN", provider = "google" } = {}) => {
    const list = texts.map((t) => String(t));
    if (!list.length) return [];
    if (provider !== "google") throw new Error(`不支持的机翻服务商：${provider}`);

    const tl = GOOGLE_LANG[toLang] || toLang || "zh-CN";
    const url = `${GOOGLE_T}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}`;
    const body = list.map((t) => `q=${encodeURIComponent(t)}`).join("&");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("机翻超时");
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`机翻 HTTP ${res.status}`);

    const data = await res.json().catch(() => null);
    if (!Array.isArray(data) || data.length !== list.length) {
      throw new Error("机翻返回条数不符");
    }
    return data.map((row, i) => {
      const text = Array.isArray(row) ? row[0] : row;
      return typeof text === "string" && text.trim() ? text : list[i];
    });
  };

  /** 从可能带 markdown 围栏 / 前后说明的文本里抠出 JSON */
  const extractJson = (text) => {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const candidates = [raw];
    const fenced = raw.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
    if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim());
    const bracketed = raw.match(/\[[\s\S]*\]/);
    if (bracketed?.[0]) candidates.push(bracketed[0]);
    for (const c of candidates) {
      try {
        return JSON.parse(c);
      } catch {
        // 换下一种形态
      }
    }
    return null;
  };

  const LANG_LABEL = {
    "zh-CN": "简体中文",
    "zh-TW": "繁体中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
  };

  // Google gtx 的语言码与上面基本一致，个别做映射
  const GOOGLE_LANG = {
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    en: "en",
    ja: "ja",
    ko: "ko",
  };

  const buildSystemPrompt = (toLang, rule) => {
    const target = LANG_LABEL[toLang] || toLang || "简体中文";
    const sections = [
      `你是专业翻译引擎。把用户给出的每一条文本翻译成${target}。`,
      "要求:保持原有语气与格式;不要擅自增删内容;不要输出解释或注释;人名、专有名词按通行译法处理。",
    ];
    if (rule?.terms) {
      const glossary = Object.entries(Transelle.parseTerms(rule.terms));
      if (glossary.length) {
        sections.push(
          `术语表(优先使用下列译法,未列出的按语境直译):\n${glossary
            .map(([k, v]) => (v ? `${k} → ${v}` : `${k} → 保留原文`))
            .join("\n")}`
        );
      }
    }
    if (rule?.prompt) {
      sections.push(`本站点补充要求:\n${rule.prompt}`);
    }
    sections.push(
      `输出格式:只输出一个 JSON 字符串数组,长度必须等于输入条数,第 i 个元素是第 i 条文本的译文。`
    );
    return sections.join("\n\n");
  };

  /**
   * 批量文本翻译。一次请求翻译多条，失败时按「逐条重试」降级。
   * @param {Object} engine
   * @param {Object} params
   * @param {string[]} params.texts
   * @param {string} [params.toLang]
   * @param {Object} [params.rule] 站点规则（术语表 / 补充提示词）
   * @returns {Promise<string[]>} 与输入等长的译文数组（失败位置为原文）
   */
  const translate = async (engine, { texts = [], toLang = "zh-CN", rule = {}, onItem } = {}) => {
    const list = texts.map((t) => String(t));
    if (!list.length) return [];

    // 分语种的外部设置（日语 / 英语成人向…）：命中才附加，站点规则优先于它们。
    let effectiveRule = rule;
    let jaCfg = null; // 只有「日语」需要不走流式 + 假名罗马音兜底
    if (Transelle.locales) {
      const active = await Transelle.locales.activeFor(list);
      if (active.length) {
        effectiveRule = {
          terms: [...active.map((l) => l.terms), rule.terms].filter(Boolean).join("\n"),
          prompt: [...active.map((l) => l.prompt), rule.prompt].filter(Boolean).join("\n"),
        };
        jaCfg = active.find((l) => l.id === "ja") || null;
      }
    }
    const jaActive = !!jaCfg;

    const system = buildSystemPrompt(toLang, effectiveRule);
    const user = JSON.stringify(list);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    // 流式优先：边生成边逐条推给界面，首句不必等整批生成完。
    // 流式不可用（网关不支持）或中途出错时，退回非流式整批，别让整批译文丢掉。
    let reply;
    // 日语批次不走流式：残留假名的「重译」发生在整批之后，流式已回填的就没法再纠正。
    if (onItem && !jaActive) {
      try {
        const streamed = await chatStream(engine, messages, {}, (i, text) => {
          if (i < list.length) onItem(i, text);
        });
        // 有内容才采信；引擎忽略 stream、返回普通 JSON 时会得到空串，转非流式重来
        if (streamed && streamed.trim()) reply = streamed;
      } catch (err) {
        Transelle.log?.warn?.("流式翻译失败，回退非流式:", err.message);
      }
    }
    if (reply === undefined) reply = await chat(engine, messages);

    const parsed = extractJson(reply);
    let out;
    if (Array.isArray(parsed) && parsed.length === list.length) {
      out = parsed.map((v, i) => (typeof v === "string" && v.trim() ? v : list[i]));
    } else {
      // 拿到了回复但格式不符（条数不对 / 不是 JSON）：这才值得逐条重试
      out = [];
      let failed = 0;
      let lastError = null;
      for (const text of list) {
        try {
          const one = extractJson(
            await chat(engine, [
              { role: "system", content: buildSystemPrompt(toLang, effectiveRule) },
              { role: "user", content: JSON.stringify([text]) },
            ])
          );
          if (Array.isArray(one) && typeof one[0] === "string" && one[0].trim()) {
            out.push(one[0]);
          } else {
            out.push(text);
            failed++;
          }
        } catch (err) {
          lastError = err;
          failed++;
          out.push(text);
        }
      }
      // 全军覆没就抛出去，让界面明确报错；
      // 部分失败则静默保留原文，不因为个别段落坏掉就中断整页翻译。
      if (failed === list.length && lastError) throw lastError;
    }

    // 目标为中文却仍夹带假名：只对这几条做一次「必须全中文」的重译，
    // 这是「日语翻不彻底」最后的兜底（只重译坏的那几条，不重跑整批）。
    if (jaActive && /^zh/i.test(String(toLang))) {
      const bad = out.map((_, i) => i).filter((i) => Transelle.hasKana(out[i]));
      if (bad.length) {
        try {
          const fixRule = {
            terms: effectiveRule.terms,
            prompt: `${effectiveRule.prompt}\n重要:上一次的译文里残留了日文假名。这一次必须把每一条都完整译成中文,不得出现任何平假名或片假名;专有名词用中文译名,拟声词用中文拟声词。`,
          };
          const fixedReply = await chat(engine, [
            { role: "system", content: buildSystemPrompt(toLang, fixRule) },
            { role: "user", content: JSON.stringify(bad.map((i) => list[i])) },
          ]);
          const fixed = extractJson(fixedReply);
          if (Array.isArray(fixed) && fixed.length === bad.length) {
            bad.forEach((i, k) => {
              if (typeof fixed[k] === "string" && fixed[k].trim()) out[i] = fixed[k];
            });
          }
        } catch (err) {
          Transelle.log?.warn?.("假名残留重译失败，保留原译文:", err.message);
        }
      }

      // 重译之后仍残留假名（多为难译的片假名，或日语里毫无意义的假名拼合）：
      // 按配置转成罗马音呈现，总好过在中文里留一串看不懂的字。
      if (jaCfg.romaji !== false && Transelle.toRomaji) {
        let converted = 0;
        out = out.map((v) => {
          if (!Transelle.hasKana(v)) return v;
          converted++;
          return Transelle.toRomaji(v);
        });
        if (converted) {
          Transelle.log?.info?.(`残留假名已转罗马音：${converted} 条`);
        }
      }
    }

    return out;
  };

  /**
   * 视觉请求：把图片交给多模态模型，返回其原始文本回复。
   * @param {Object} engine
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.imageDataUrl data:image/...;base64,xxx
   * @param {number} [params.maxTokens]
   * @returns {Promise<string>}
   */
  const vision = async (engine, { systemPrompt, imageDataUrl, maxTokens = 2048 } = {}) => {
    if (!imageDataUrl) throw new Error("缺少图片数据");
    return chat(
      engine,
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "翻译这张图中的文字，按约定 JSON 返回。" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      { timeout: DEFAULT_VISION_TIMEOUT, maxTokens, temperature: 0.2 }
    );
  };

  /** 连通性测试：发一条最短的翻译请求 */
  const test = async (engine) => {
    const started = Date.now();
    const reply = await chat(
      engine,
      [
        { role: "system", content: "把用户输入翻译成简体中文，只输出译文。" },
        { role: "user", content: "hello" },
      ],
      { timeout: 30000, maxTokens: 64 }
    );
    return { ok: true, ms: Date.now() - started, sample: reply.trim().slice(0, 60) };
  };

  Transelle.engines = { chat, chatStream, translate, fastTranslate, vision, test, createArrayStreamParser };
})(typeof globalThis !== "undefined" ? globalThis : self);
