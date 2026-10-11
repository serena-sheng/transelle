/**
 * @file collector.js
 * @description 待翻译文本节点的收集。按站点规则给的 selector 圈定范围，
 * ignoreSelector 排除干扰元素，再逐文本节点过滤。
 *
 * 过滤掉的东西：空白、纯数字/符号、单字符、可编辑区域、代码块、
 * 我们自己注入的节点（避免自翻译）、以及已经翻译过的节点。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.collector) return;

  // 至少包含一个字母/汉字/假名才算「有内容」，纯数字与符号没有翻译价值
  const HAS_WORD = /[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const MIN_LENGTH = 2;

  // 这些标签内部永不翻译
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "SVG",
    "CANVAS",
    "MATH",
  ]);

  const shouldSkipByTag = (el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.tagName && SKIP_TAGS.has(node.tagName)) return true;
      // 我们自己注入的一切（文案层、悬浮按钮、弹幕栏）都带这个标记
      if (node.dataset && node.dataset.transelleSkip !== undefined) return true;
      node = node.parentElement;
    }
    return false;
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
     * @param {Object} rule 站点规则（selector / ignoreSelector）
     * @param {Node} [scope] 限定范围的根节点，默认整篇文档
     * @returns {Array<{node: Text, text: string, tier: "deep"|"fast"}>}
     */
    collect(rule = {}, scope = document) {
      const selector = (rule.selector || "").trim() || Transelle.DEFAULT_SELECTOR;
      const ignoreSelector =
        (rule.ignoreSelector || "").trim() || Transelle.DEFAULT_IGNORE_SELECTOR;

      let roots;
      try {
        roots = scope.querySelectorAll(selector);
      } catch (err) {
        Transelle.log.warn("站点选择器无效，回退默认选择器:", rule.selector, err);
        roots = scope.querySelectorAll(Transelle.DEFAULT_SELECTOR);
      }

      const out = [];
      const seenText = new Set();

      roots.forEach((element) => {
        if (shouldSkipByTag(element)) return;
        // 命中忽略选择器的元素整棵跳过
        if (ignoreSelector && element.matches?.(ignoreSelector)) return;
        if (Transelle.isEditable(element)) return;

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const raw = node.nodeValue || "";
            const text = raw.trim();
            if (text.length < MIN_LENGTH) return NodeFilter.FILTER_REJECT;
            if (!HAS_WORD.test(text)) return NodeFilter.FILTER_REJECT;
            if (isTranslated(node)) return NodeFilter.FILTER_REJECT;
            if (Transelle.isEditable(node)) return NodeFilter.FILTER_REJECT;
            if (node.parentElement && ignoreSelector) {
              if (node.parentElement.closest(ignoreSelector)) {
                return NodeFilter.FILTER_REJECT;
              }
            }
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
      });

      return out;
    },

    /** 页面是否已经没有可翻译内容（用于判断是否要提示用户） */
    isEmpty(rule) {
      return Transelle.collector.collect(rule).length === 0;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
