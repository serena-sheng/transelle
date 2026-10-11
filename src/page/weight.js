/**
 * @file weight.js
 * @description 内容权重：判断一段文本是「正文」还是「边角」，供分流使用。
 *
 * 思路与 Safari「阅读正文」同源——按元素在 DOM 里的位置、标签语义、类名与链接密度
 * 打分：分高的是正文（值得交给 DeepSeek 精翻），分低的是导航 / 页脚 / 侧栏 / 评论 /
 * 列表页签等（机翻足够）。输出只有两档：`deep`（精翻）与 `fast`（机翻）。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.weight) return;

  // 标签语义：正分偏正文，负分偏边角
  const TAG_SCORE = {
    ARTICLE: 3, MAIN: 3, P: 1, BLOCKQUOTE: 1, FIGCAPTION: 1, SECTION: 0.5,
    NAV: -4, ASIDE: -4, FOOTER: -4, HEADER: -3, FORM: -2,
    BUTTON: -1, LABEL: -1, FIGURE: -1,
  };
  // 类名 / id 关键词（按词边界匹配，避免 "content" 命中 "contentious" 这类误伤）
  const POS_ATTR = /(^|[-_ ])(article|post|entry|content|main|story|markdown|prose|chapter|read|detail)([-_ ]|$)/i;
  const NEG_ATTR = /(^|[-_ ])(nav|menu|footer|header|aside|sidebar|side|comment|meta|breadcrumb|toolbar|share|social|related|recommend|promo|advert|ad|ads|banner|cookie|pagination|pager|byline|widget|subscribe|newsletter|copyright)([-_ ]|$)/i;

  const DEEP_THRESHOLD = 2; // ≥ 此分算正文

  const attrOf = (el) => {
    const cls = typeof el.className === "string" ? el.className : "";
    return `${el.id || ""} ${cls}`.trim();
  };

  /** 链接密度：正文里链接占比低，导航/列表里占比高 */
  const linkDensity = (el) => {
    const total = (el.textContent || "").length;
    if (!total) return 0;
    let linked = 0;
    el.querySelectorAll("a").forEach((a) => {
      linked += (a.textContent || "").length;
    });
    return linked / total;
  };

  const cache = new WeakMap();

  /**
   * 给元素打分（记忆化）。分越高越像正文。
   * @param {Element} el 通常传文本节点的父元素
   * @returns {number}
   */
  const scoreOf = (el) => {
    if (!el || el.nodeType !== 1) return 0;
    if (cache.has(el)) return cache.get(el);

    let score = 0;
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node.tagName !== "BODY" && depth < 10) {
      score += TAG_SCORE[node.tagName] || 0;
      const attr = attrOf(node);
      if (attr) {
        if (POS_ATTR.test(attr)) score += 2;
        if (NEG_ATTR.test(attr)) score -= 3;
      }
      node = node.parentElement;
      depth++;
    }

    const len = (el.textContent || "").trim().length;
    if (len >= 40) score += 1;
    if (len >= 120) score += 1;

    const ld = linkDensity(el);
    if (ld > 0.5) score -= 2;
    else if (ld < 0.15 && len >= 30) score += 1;

    cache.set(el, score);
    return score;
  };

  Transelle.weight = {
    threshold: DEEP_THRESHOLD,
    score: scoreOf,
    /** "deep" = 正文（精翻）；"fast" = 边角（机翻） */
    tier(el) {
      return scoreOf(el) >= DEEP_THRESHOLD ? "deep" : "fast";
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
