/**
 * @file renderer.js
 * @description 译文注入与回滚。
 *
 * 双语模式：原文不动，紧随其后插入译文节点。
 * 仅译文模式：把原文文本节点包进 src 容器并隐藏，再插入译文；译文节点带 title，
 *            鼠标悬停可看到原文（不做 hover 展开，避免把页面布局搞乱）。
 *
 * 所有注入节点都带 `data-transelle-skip`，收集器据此跳过，避免自我翻译。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.renderer) return;

  // 已处理过的文本节点。Text 节点不能挂 dataset，只能用 WeakSet 记录
  const handled = new WeakSet();

  let mode = "bilingual";
  let highlight = false;

  const STYLE_ID = "transelle-style";

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.dataset.transelleSkip = "";
    style.textContent = `
[data-transelle-layer="trans"], [data-transelle-src="1"] { all: unset; }
[data-transelle-layer="trans"][data-highlight="1"] {
  background: rgba(240, 69, 126, 0.12);
  border-bottom: 1px solid rgba(240, 69, 126, 0.4);
  border-radius: 2px;
}
[data-transelle-src="1"][data-hidden="1"] { display: none !important; }
`;
    (document.head || document.documentElement).appendChild(style);
  };

  const markHandled = (node) => {
    handled.add(node);
    const parent = node.parentElement;
    if (parent) parent.dataset.transelleHost = "1";
  };

  Transelle.renderer = {
    has: (node) => handled.has(node),

    setMode(next) {
      mode = next === "only" ? "only" : "bilingual";
    },

    setHighlight(on) {
      highlight = !!on;
    },

    /**
     * 渲染一条译文。
     * @param {Text} node 原文文本节点
     * @param {string} translated 译文
     */
    render(node, translated) {
      if (!node || !node.parentNode) return;
      const parent = node.parentNode;

      ensureStyle();

      // 仅译文模式：先把原文包起来藏掉
      if (mode === "only") {
        const src = document.createElement("span");
        src.dataset.transelleSkip = "";
        src.dataset.transelleSrc = "1";
        src.dataset.hidden = "1";
        src.setAttribute("title", node.nodeValue);
        parent.insertBefore(src, node);
        src.appendChild(node);
        markHandled(node);
      }

      const span = document.createElement("span");
      span.dataset.transelleSkip = "";
      span.dataset.transelleLayer = "trans";
      span.dataset.highlight = highlight ? "1" : "0";
      span.textContent = translated;
      if (mode === "only") span.setAttribute("title", node.nodeValue);

      // 插到原文节点之后；双语模式下原文节点本身留在原位
      if (mode === "only") {
        const src = parent.querySelector('[data-transelle-src="1"]:last-of-type');
        parent.insertBefore(span, src ? src.nextSibling : null);
      } else {
        parent.insertBefore(span, node.nextSibling);
      }

      markHandled(node);
    },

    /**
     * 页面内持续显示的翻译进度（顶部小胶囊）。传空值即移除。
     * 整页翻译会持续数秒到数十秒，没有它，用户只会以为「点了没反应」。
     */
    progress(text) {
      const ID = "transelle-progress";
      let el = document.getElementById(ID);
      if (!text) {
        el?.remove();
        return;
      }
      if (!el) {
        el = document.createElement("div");
        el.id = ID;
        el.dataset.transelleSkip = "";
        el.classList.add("notranslate");
        el.style.cssText = [
          "position:fixed",
          "left:50%",
          "top:16px",
          "transform:translateX(-50%)",
          "padding:5px 14px",
          "border-radius:999px",
          "font-family:system-ui,-apple-system,sans-serif",
          "font-size:12px",
          "font-weight:600",
          "color:#fff",
          "background:#E93D82",
          "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
          "z-index:2147483647",
          "pointer-events:none",
        ].join(";");
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text;
    },

    /**
     * 页面内轻量提示。翻译失败时必须让用户看见，
     * 否则「点了没反应」和「扩展坏了」在用户眼里没区别。
     */
    toast(message, kind = "error") {
      const ID = "transelle-toast";
      let el = document.getElementById(ID);
      if (!el) {
        el = document.createElement("div");
        el.id = ID;
        el.dataset.transelleSkip = "";
        el.classList.add("notranslate");
        el.style.cssText = [
          "position:fixed",
          "left:50%",
          "bottom:24px",
          "transform:translateX(-50%)",
          "max-width:80vw",
          "padding:10px 18px",
          "border-radius:999px",
          "font-family:system-ui,-apple-system,sans-serif",
          "font-size:13px",
          "line-height:1.4",
          "color:#fff",
          "box-shadow:0 6px 24px rgba(0,0,0,0.24)",
          "z-index:2147483647",
          "pointer-events:none",
          "transition:opacity .25s",
          "opacity:0",
        ].join(";");
        (document.body || document.documentElement).appendChild(el);
      }
      el.style.background = kind === "error" ? "#D64545" : "#E93D82";
      el.textContent = message;
      el.style.opacity = "1";
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => {
        el.style.opacity = "0";
      }, 4500);
    },

    /** 移除所有注入、把页面还原到翻译前的样子 */
    clear() {
      document.getElementById("transelle-toast")?.remove();
      document.getElementById("transelle-progress")?.remove();

      document
        .querySelectorAll('[data-transelle-layer="trans"]')
        .forEach((el) => el.remove());

      // 仅译文模式下被包起来的原文：拆掉外壳放回原位
      document.querySelectorAll('[data-transelle-src="1"]').forEach((src) => {
        const text = src.getAttribute("title") ?? src.textContent ?? "";
        const textNode = document.createTextNode(text);
        src.parentNode?.replaceChild(textNode, src);
      });

      document
        .querySelectorAll("[data-transelle-host]")
        .forEach((el) => delete el.dataset.transelleHost);

      document.getElementById(STYLE_ID)?.remove();
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
