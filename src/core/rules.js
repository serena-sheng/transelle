/**
 * @file rules.js
 * @description 站点特化规则：按 URL 匹配站点，给出「待翻译元素 / 忽略元素 / 术语表 / 补充提示词」。
 * 规则完全由用户维护：在设置页「站点特化」里自行添加，扩展不含任何内置站点预设。
 * 用户规则存在 chrome.storage 里。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.rules) return;

  // --- 网页翻译默认元素 ---
  Transelle.DEFAULT_SELECTOR =
    "h1, h2, h3, h4, h5, h6, li, p, dd, blockquote, figcaption, label, legend";
  Transelle.DEFAULT_IGNORE_SELECTOR =
    "button, footer, pre, mark, nav, svg, img[src*='.svg'], [class*='logo'] svg, [id*='logo'] svg";

  /** 规则空模板 */
  Transelle.DEFAULT_RULE = {
    pattern: "",
    pageEnabled: true,
    mangaEnabled: false,
    selector: "",
    ignoreSelector: "",
    terms: "",
    prompt: "",
  };

  // 术语表解析在 core/shared.js（Transelle.parseTerms），background 也要用


  // 内置规则表：不含任何站点预设；用户在设置页自行添加规则。
  Transelle.BUILTIN_RULES = [];

  const hasValue = (v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim() !== "";
    return true;
  };

  Transelle.rules = {
    /** 命中给定 URL 的规则；用户规则按字段覆盖内置规则 */
    forUrl(href, userRules = []) {
      const builtin = Transelle.BUILTIN_RULES.find((r) =>
        Transelle.matchPattern(href, r.pattern)
      );
      const user = userRules.find((r) =>
        Transelle.matchPattern(href, r.pattern)
      );

      const base = builtin
        ? { ...Transelle.DEFAULT_RULE, ...builtin }
        : { ...Transelle.DEFAULT_RULE };

      if (!user) return base;

      const merged = { ...base, pattern: user.pattern };
      Object.keys(Transelle.DEFAULT_RULE).forEach((key) => {
        if (key === "pattern") return;
        if (hasValue(user[key])) merged[key] = user[key];
      });
      return merged;
    },

    /** 该 URL 是否命中过任何内置/用户规则（设置页展示用） */
    matched(href, userRules = []) {
      return (
        Transelle.BUILTIN_RULES.some((r) => Transelle.matchPattern(href, r.pattern)) ||
        userRules.some((r) => Transelle.matchPattern(href, r.pattern))
      );
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
