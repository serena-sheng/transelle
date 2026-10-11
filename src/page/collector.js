/**
 * @file collector.js
 * @description 待翻译文本节点的收集。
 *
 * 不再依赖一份写死的标签白名单（那样会漏掉大量用 `<div>`/`<span>`/`<td>` 排版的正文），
 * 改成**遍历全部文本节点**，再用「块级祖先 + 忽略/跳过规则」来过滤：
 * - 穿过一串行内元素（`span`/`a`/`b`…）找到承载内容的**块级祖先**；
 * - 该祖先落在 SKIP_TAGS（脚本、代码、输入框…）或忽略选择器里，就跳过；
 * - 站点规则若指定了 selector，则只翻落在其内的文本。
 *
 * 过滤掉的还有：空白、纯数字/符号、单字符、可编辑区域，以及已经翻过的节点。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.collector) return;

  // 至少包含一个字母/汉字/假名才算「有内容」，纯数字与符号没有翻译价值
  const HAS_WORD = /[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const MIN_LENGTH = 2;

  // 这些标签内部永不翻译
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "CANVAS", "MATH",
    "HEAD", "TITLE", "TEMPLATE", "IFRAME",
  ]);

  // 行内元素：不是它们自己的「块」，要往上找到真正承载文本的块级祖先
  const INLINE_TAGS = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "BIG", "BR", "CITE", "DEL", "DFN", "EM",
    "FONT", "I", "IMG", "INS", "MARK", "NOBR", "Q", "RP", "RT", "RUBY", "S",
    "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "TIME", "TT", "U", "VAR", "WBR",
  ]);

  /** 文本节点所属的块级祖先（穿过一串行内元素） */
  const blockOf = (node) => {
    let el = node.parentElement;
    while (el && INLINE_TAGS.has(el.tagName)) el = el.parentElement;
    return el;
  };

  const skipCache = new WeakMap();
  /** 从该元素到 body 之间是否有 SKIP_TAGS / 我们自己注入的节点 */
  const shouldSkipBlock = (el) => {
    if (!el) return true;
    if (skipCache.has(el)) return skipCache.get(el);
    let node = el;
    let skip = false;
    while (node && node !== document.body) {
      if (node.tagName && SKIP_TAGS.has(node.tagName)) { skip = true; break; }
      if (node.dataset && node.dataset.transelleSkip !== undefined) { skip = true; break; }
      // 隐藏内容不必翻（省 token，也避免翻到折叠菜单）
      if (node.hidden === true) { skip = true; break; }
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") { skip = true; break; }
      if (node.style && (node.style.display === "none" || node.style.visibility === "hidden")) {
        skip = true;
        break;
      }
      node = node.parentElement;
    }
    skipCache.set(el, skip);
    return skip;
  };

  /** 安全版 closest：选择器非法时不抛错 */
  const safeClosest = (el, selector) => {
    if (!selector) return null;
    try {
      return el.closest(selector);
    } catch {
      return null;
    }
  };

  const isTranslated = (node) => {
    // 渲染层记录过「已处理」的文本节点，直接跳过（Text 节点没法挂 dataset）
    if (Transelle.renderer?.has?.(node)) return true;
    const parent = node.parentElement;
    if (!parent) return false;
    // 落在译文节点内部的一律跳过，避免把自己的译文再翻一遍
    return !!parent.closest("[data-transelle-layer]");
  };

  Transelle.collector = {
    /**
     * 收集给定范围内的待翻译文本节点。
     * @param {Object} rule 站点规则（selector 限定范围 / ignoreSelector 排除）
     * @param {Node} [scope] 限定范围的根节点，默认整篇文档
     * @returns {Array<{node: Text, text: string, tier: "deep"|"fast"}>}
     */
    collect(rule = {}, scope = document) {
      const selector = (rule.selector || "").trim(); // 站点自定义：只翻其内的文本
      const ignoreSelector =
        (rule.ignoreSelector || "").trim() || Transelle.DEFAULT_IGNORE_SELECTOR;

      if (selector) {
        try {
          scope.querySelector?.(selector);
        } catch (err) {
          Transelle.log.warn("站点选择器无效，忽略该限制:", rule.selector, err);
        }
      }

      const out = [];
      const seenText = new Set();
      const matchCache = new WeakMap(); // block -> 是否命中忽略/选择器

      const matchKey = (block) => {
        if (matchCache.has(block)) return matchCache.get(block);
        const ignored = !!safeClosest(block, ignoreSelector);
        const allowed = !selector || !!safeClosest(block, selector);
        const result = { ignored, allowed };
        matchCache.set(block, result);
        return result;
      };

      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // 关键：TreeWalker 对元素节点返回 REJECT 会连整棵子树一起剪掉，
          // 必须用 SKIP 才能继续往下走（SHOW_TEXT 只决定「收哪些」，不下潜决定）。
          if (node.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_SKIP;

          const text = (node.nodeValue || "").trim();
          if (text.length < MIN_LENGTH) return NodeFilter.FILTER_REJECT;
          if (!HAS_WORD.test(text)) return NodeFilter.FILTER_REJECT;

          const block = blockOf(node);
          if (!block || shouldSkipBlock(block)) return NodeFilter.FILTER_REJECT;
          const { ignored, allowed } = matchKey(block);
          if (ignored || !allowed) return NodeFilter.FILTER_REJECT;
          if (isTranslated(node)) return NodeFilter.FILTER_REJECT;
          if (Transelle.isEditable(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.nodeValue.trim();
        // 同一文本在同一页多处出现时，只翻译一次，其余复用缓存
        const dedupeKey = Transelle.hash(text);
        if (seenText.has(dedupeKey)) continue;
        seenText.add(dedupeKey);
        out.push({
          node,
          text,
          // 分流用：正文（deep）交给精翻引擎，边角（fast）交给免费机翻
          tier: Transelle.weight ? Transelle.weight.tier(node.parentElement) : "deep",
        });
      }

      return out;
    },

    /** 页面是否已经没有可翻译内容（用于判断是否要提示用户） */
    isEmpty(rule) {
      return Transelle.collector.collect(rule).length === 0;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
