/**
 * @file visionPrompt.js
 * @description 漫画视觉提示词，以及视觉模型返回内容的容错解析。
 *
 * 视觉模型不保证严格 JSON：可能带 markdown 围栏、前后解释文字，或字段缺失，
 * 因此解析层必须容忍这些形态，失败时返回空数组（宁可不翻，也不出错位译文）。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.mangaPrompt) return;

  // 坐标校验：允许少量溢出（模型偶有越界一两像素），越界超过 20% 说明坐标系不对
  const BOX_SLACK_RATIO = 0.2;
  const MIN_BOX_SIZE = 4; // 夹紧后小于该尺寸的框视为噪声
  const MIN_VALID_RATIO = 0.5; // 有效框占比低于此值 → 整条结果不可信

  /**
   * 气泡识别的系统提示词。约定返回 `[{box:[x1,y1,x2,y2], src, dst, vertical}]`，
   * box 为**归一化坐标**（0~1）。
   *
   * 为什么用归一化而不是像素：真机实测（2026-10-09）模型给归一化值时两个方向都准到 0.01 以内；
   * 给像素值时 y 会被系统性压到 0.7 倍左右，整块译文偏上。
   */
  const BASE_PROMPT = `你是漫画翻译引擎。检测图片中所有包含文字的气泡、对话框、旁白框和音效字,将其中文字翻译成简体中文,以严格 JSON 数组返回,不要输出任何其他内容:
[{"box":[x1,y1,x2,y2],"src":"原文","dst":"译文","vertical":true}]
要求:
1. box 用归一化坐标:0~1 之间的小数,x 除以图宽、y 除以图高(左上角是 [0,0],右下角是 [1,1]),保留 4 位小数,紧贴文字;
2. vertical:原文为竖排(日语漫画常见)则为 true,横排为 false;
3. 无文字的图返回 [];
4. 译文要求:忠实翻译气泡内的文字与潜台词,保留说话人语气;日语省略的主语和语气词(央求、抗拒、羞耻、兴奋等)要在中文体现出来;拟声词翻译为中文惯用拟声词;同一格内多个气泡按阅读顺序排列;
5. 只输出 JSON,不要 markdown 代码块标记。`;

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

  /** 由站点规则拼装完整提示词：基础指令 + 术语表 + 站点补充要求 */
  const buildVisionPrompt = ({ prompt = "", terms = "" } = {}) => {
    const glossary = Object.entries(Transelle.parseTerms(terms));
    const extra = String(prompt || "").trim();
    if (!glossary.length && !extra) return BASE_PROMPT;

    const sections = [BASE_PROMPT];
    if (glossary.length) {
      sections.push(
        `术语表(优先使用下列译法,未列出的按语境直译):\n${glossary
          .map(([k, v]) => (v ? `${k} → ${v}` : `${k} → 保留原文`))
          .join("\n")}`
      );
    }
    if (extra) sections.push(`本站点补充要求:\n${extra}`);
    sections.push("以上补充要求不改变输出格式:仍然只输出 JSON 数组。");
    return sections.join("\n\n");
  };

  const normalizeBubble = (item) => {
    const box = item?.box;
    if (!Array.isArray(box) || box.length !== 4) return null;
    const [x1, y1, x2, y2] = box.map(Number);
    if (![x1, y1, x2, y2].every(isFiniteNumber)) return null;

    const dst = typeof item?.dst === "string" ? item.dst.trim() : "";
    if (!dst) return null; // 没有译文的框没有意义

    return {
      box: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
      src: typeof item?.src === "string" ? item.src : "",
      dst,
      vertical: item?.vertical === true,
    };
  };

  /**
   * 夹紧单个气泡坐标到发送图范围内。
   * 见过模型把整页当规则网格返回（1500×1978 的图报成 x 到 3200 的 32 个格子），
   * 这类坐标不属于这张图，拿去渲染只会得到挤在顶部的乱码。
   */
  const clampBubble = (bubble, width, height) => {
    const [x1, y1, x2, y2] = bubble.box;
    const slackX = width * BOX_SLACK_RATIO;
    const slackY = height * BOX_SLACK_RATIO;
    if (x2 < -slackX || y2 < -slackY || x1 > width + slackX || y1 > height + slackY) {
      return null;
    }
    const box = [
      Math.max(0, Math.min(width, x1)),
      Math.max(0, Math.min(height, y1)),
      Math.max(0, Math.min(width, x2)),
      Math.max(0, Math.min(height, y2)),
    ];
    if (box[2] - box[0] < MIN_BOX_SIZE || box[3] - box[1] < MIN_BOX_SIZE) return null;
    return { ...bubble, box };
  };

  const toPixel = (bubble, width, height) => ({
    ...bubble,
    box: [
      bubble.box[0] * width,
      bubble.box[1] * height,
      bubble.box[2] * width,
      bubble.box[3] * height,
    ],
  });

  const validate = (bubbles, { width, height } = {}) => {
    if (!Array.isArray(bubbles)) return [];
    if (!(width > 0) || !(height > 0)) return bubbles;
    const valid = bubbles.map((b) => clampBubble(b, width, height)).filter(Boolean);
    // 大多数坐标都越界 → 整条结果不可信（坐标系不对），当作失败
    if (bubbles.length && valid.length / bubbles.length < MIN_VALID_RATIO) return [];
    return valid;
  };

  /**
   * 从模型回复里提取气泡数组。
   * 依次尝试：整段直接解析、去 markdown 围栏、正则截取首个数组。
   * @param {string} raw
   * @param {{width:number,height:number}} [bounds] 发送图尺寸；给了就把归一化坐标换算成像素并校验
   */
  const parseVisionResult = (raw, bounds = null) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return [];

    const candidates = [text];
    const fenced = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
    if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim());
    const arrayText = text.match(/\[[\s\S]*\]/);
    if (arrayText?.[0]) candidates.push(arrayText[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (!Array.isArray(parsed)) continue;
        const bubbles = parsed.map(normalizeBubble).filter(Boolean);
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return bubbles;
        const pixels = bubbles.map((b) => toPixel(b, bounds.width, bounds.height));
        return validate(pixels, bounds);
      } catch {
        // 该形态解析失败，继续尝试下一种
      }
    }
    return [];
  };

  Transelle.mangaPrompt = {
    BASE_PROMPT,
    buildVisionPrompt,
    parseVisionResult,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
