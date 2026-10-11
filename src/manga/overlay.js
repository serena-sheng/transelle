/**
 * @file overlay.js
 * @description 漫画译文的两种显示方式与悬浮开关。
 *
 * 1. `overlay`（嵌字）：在图片上按气泡坐标铺译文块。
 * 2. `danmaku`（侧栏弹幕）：把图片压窄，在两侧腾出栏位，译文像弹幕一样贴在栏里，
 *    纵向与原文位置对齐、逐条向下堆积不重叠、统一横排字号，按气泡左右分栏。
 *    某一侧译文堆出图片高度（爆满）时，该栏转为可滚动，滚动浏览全部译文。
 *
 * 用原生 DOM 而不是框架挂载：这里需要「按图片逐个挂载 / 切换模式 / 更新 / 移除」，
 * 直接操作 DOM 更可控。所有注入元素都带 `data-transelle-skip` 与 `notranslate`，
 * 既不会被本扩展的网页翻译翻一遍，也不会被浏览器的整页翻译动到。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.mangaOverlay) return;

  const OVERLAY_CLASS = "transelle-manga-overlay";
  const BUBBLE_CLASS = "transelle-manga-bubble";
  const GUTTER_CLASS = "transelle-manga-gutter";
  const DANMAKU_CLASS = "transelle-manga-danmaku";
  const TOGGLE_CLASS = "transelle-manga-toggle";
  const MARKER_CLASS = "transelle-manga-marker";
  const HINT_CLASS = "transelle-manga-scrollhint";

  // 字号按气泡面积与译文长度估算后的取值区间（px，渲染后的像素）
  const MIN_FONT_SIZE = 9;
  const MAX_FONT_SIZE = 44;

  // 侧栏弹幕：栏宽按容器比例取，夹在上下限之间；条目统一字号与行高
  const GUTTER_RATIO = 0.2;
  const GUTTER_MIN_WIDTH = 150;
  const GUTTER_MAX_WIDTH = 300;
  const DANMAKU_FONT_SIZE = 14;
  const DANMAKU_GAP = 6;
  const MIN_IMAGE_WIDTH = 120;
  // 可滚动栏两端「还有内容」的低调提示高度与触发阈值（px）
  const SCROLL_HINT_HEIGHT = 22;
  const SCROLL_HINT_THRESHOLD = 6;

  /** 显示方式 */
  const MODE_MANGA_OVERLAY = "overlay";
  const MODE_MANGA_DANMAKU = "danmaku";
  /** 悬浮开关的关闭态 */
  const TOGGLE_STATE_OFF = "off";

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const prefersReducedMotion = () =>
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** 给注入节点打上标记：不被本扩展翻译，也不被浏览器翻译 */
  const markInjected = (el) => {
    el.dataset.transelleSkip = "";
    el.classList.add("notranslate");
    return el;
  };

  /** 嵌字模式：在图片上铺一层按百分比定位的译文块 */
  const createOverlay = (
    img,
    { bubbles = [], naturalWidth = 0, naturalHeight = 0 } = {}
  ) => {
    const overlay = markInjected(document.createElement("div"));
    overlay.className = `${OVERLAY_CLASS} notranslate`;
    overlay.style.cssText = `position:absolute; pointer-events:none; z-index:10; overflow:visible;`;

    const items = bubbles.map((bubble) => {
      const [x1, y1, x2, y2] = bubble.box;
      const el = markInjected(document.createElement("div"));
      el.className = `${BUBBLE_CLASS} notranslate`;
      el.textContent = bubble.dst;
      el.style.cssText = [
        "position:absolute",
        "box-sizing:border-box",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "text-align:center",
        `left:${((x1 / naturalWidth) * 100).toFixed(4)}%`,
        `top:${((y1 / naturalHeight) * 100).toFixed(4)}%`,
        `width:${(((x2 - x1) / naturalWidth) * 100).toFixed(4)}%`,
        `min-height:${(((y2 - y1) / naturalHeight) * 100).toFixed(4)}%`,
        // 不透明底：把原文盖住，避免中英叠在一起
        "background:#FFF8FB",
        "color:#111",
        "border-radius:6px",
        "padding:1px 2px",
        "line-height:1.3",
        "overflow-wrap:break-word",
        "overflow:hidden",
        "pointer-events:none",
        `writing-mode:${bubble.vertical ? "vertical-rl" : "horizontal-tb"}`,
      ].join(";");
      overlay.appendChild(el);
      return { el, box: bubble.box, text: String(bubble.dst || "") };
    });

    // 覆盖层紧跟在图片之后，避免打乱页面既有子元素顺序
    img.insertAdjacentElement("afterend", overlay);

    // 对齐几何：父容器已定位，图片的 offset* 即相对父容器内边距盒的坐标
    const sync = () => {
      const width = img.offsetWidth;
      const height = img.offsetHeight;
      overlay.style.left = `${img.offsetLeft}px`;
      overlay.style.top = `${img.offsetTop}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;

      const renderedHeight = img.clientHeight || height;
      const renderedWidth = img.clientWidth || width;
      items.forEach(({ el, box, text }) => {
        // 按「气泡面积 ÷ 译文长度」估字号：让译文大致填满气泡，而不是固定小字
        const boxWidth = ((box[2] - box[0]) / naturalWidth) * renderedWidth;
        const boxHeight = ((box[3] - box[1]) / naturalHeight) * renderedHeight;
        const area = Math.max(boxWidth * boxHeight, 1);
        const chars = Math.max(text.length, 1);
        el.style.fontSize = `${clamp(
          Math.sqrt(area / (chars * 1.15)),
          MIN_FONT_SIZE,
          MAX_FONT_SIZE
        ).toFixed(1)}px`;
      });
    };

    sync();

    return {
      sync,
      setVisible(visible) {
        overlay.style.display = visible ? "" : "none";
      },
      destroy() {
        overlay.remove();
      },
    };
  };

  /**
   * 侧栏弹幕模式：把图片压窄，左右各腾一条栏位，译文按原文纵向位置逐条往下堆。
   *
   * 左右分栏按气泡水平中心决定；两栏各自「按锚点排序后顺排」，因此既不重叠，
   * 又尽量贴着原文的纵向位置。某一侧堆出图片高度时该栏转为可滚动。
   */
  const createGutters = (
    img,
    { bubbles = [], naturalWidth = 0, naturalHeight = 0 } = {}
  ) => {
    const parent = img.parentElement;
    const parentWidth = parent.clientWidth || img.offsetWidth || 0;
    // 侧栏宽度 = 容器宽度的固定比例，夹在上下限之间；容器过窄时再按
    // 「至少给图片留 MIN_IMAGE_WIDTH」收紧，免得把图片挤出容器。
    const naturalGutter = clamp(
      Math.round(parentWidth * GUTTER_RATIO),
      GUTTER_MIN_WIDTH,
      GUTTER_MAX_WIDTH
    );
    const maxGutterByFit = Math.max(
      0,
      Math.floor((parentWidth - MIN_IMAGE_WIDTH) / 2)
    );
    const gutterWidth = Math.max(
      Math.min(naturalGutter, maxGutterByFit),
      Math.min(GUTTER_MIN_WIDTH, Math.floor(parentWidth / 4))
    );
    // 让出两侧栏后图片可用的宽度
    const availWidth = Math.max(parentWidth - gutterWidth * 2, MIN_IMAGE_WIDTH);
    // 图片当前渲染宽度。只压窄、不放大：目标宽度比当前更窄时才改宽度，
    // 否则小图会被拉伸变形。
    const beforeWidth = img.offsetWidth || img.clientWidth || parentWidth;
    const shrinkWidth = beforeWidth > 0 && availWidth < beforeWidth;

    // 记住图片原本的内联样式，退出/隐藏时还原（页面自己的 CSS 不动）
    const originalStyle = {
      width: img.style.width,
      maxWidth: img.style.maxWidth,
      height: img.style.height,
      marginLeft: img.style.marginLeft,
      marginRight: img.style.marginRight,
    };

    const restoreImage = () => {
      if (originalStyle.width) img.style.width = originalStyle.width;
      else img.style.removeProperty("width");
      if (originalStyle.maxWidth) img.style.maxWidth = originalStyle.maxWidth;
      else img.style.removeProperty("max-width");
      if (originalStyle.height) img.style.height = originalStyle.height;
      else img.style.removeProperty("height");
      if (originalStyle.marginLeft) img.style.marginLeft = originalStyle.marginLeft;
      else img.style.removeProperty("margin-left");
      if (originalStyle.marginRight) img.style.marginRight = originalStyle.marginRight;
      else img.style.removeProperty("margin-right");
    };

    // 关键：不只缩宽度，还要左右各留出栏宽的外边距，否则图片（常见左对齐）会和侧栏重叠。
    // 「是否压窄」与「是否让位」是两件事：即使图片本来就比目标宽度窄（不该放大），
    // 也必须让出左右 margin，否则钉在容器边缘的侧栏会直接压在图片上。
    const applyNarrow = () => {
      restoreImage();
      if (shrinkWidth) {
        img.style.width = `${availWidth}px`;
        img.style.maxWidth = "none";
        img.style.height = "auto";
      }
      img.style.marginLeft = `${gutterWidth}px`;
      img.style.marginRight = `${gutterWidth}px`;
    };
    applyNarrow();

    const gutters = {
      left: markInjected(document.createElement("div")),
      right: markInjected(document.createElement("div")),
    };
    Object.entries(gutters).forEach(([side, el]) => {
      el.className = `${GUTTER_CLASS} notranslate`;
      el.dataset.side = side;
      el.style.cssText = [
        "position:absolute",
        "top:0",
        "box-sizing:border-box",
        "overflow:visible",
        "pointer-events:none",
        "z-index:10",
        `width:${gutterWidth}px`,
      ].join(";");
      parent.appendChild(el);
    });

    const mid = naturalWidth / 2;
    const items = bubbles.map((bubble) => {
      const [x1, y1, x2, y2] = bubble.box;
      const side = (x1 + x2) / 2 < mid ? "left" : "right";
      const el = markInjected(document.createElement("div"));
      el.className = `${DANMAKU_CLASS} notranslate`;
      el.dataset.side = side;
      // 统一横排、统一字号；宽度受栏宽限制，超出即换行
      el.textContent = String(bubble.dst || "");
      el.style.cssText = [
        "position:absolute",
        "box-sizing:border-box",
        "width:100%",
        `font-size:${DANMAKU_FONT_SIZE}px`,
        "line-height:1.35",
        // 白玻璃弹幕块，品红左边条点睛；漫画页再花也压得住
        "color:#3A2230",
        "background:rgba(255,255,255,0.9)",
        "backdrop-filter:blur(10px)",
        "-webkit-backdrop-filter:blur(10px)",
        "border-left:3px solid #F0457E",
        "box-shadow:0 1px 4px rgba(0,0,0,0.18)",
        "border-radius:6px",
        "padding:3px 6px",
        "overflow-wrap:break-word",
        "white-space:pre-wrap",
        "pointer-events:none",
      ].join(";");
      gutters[side].appendChild(el);
      // 入场：从靠图片的一侧滑入，做出弹幕「发射」的感觉（尊重 prefers-reduced-motion）
      if (!prefersReducedMotion() && typeof el.animate === "function") {
        const offset = side === "left" ? -14 : 14;
        el.animate(
          [
            { opacity: 0, transform: `translateX(${offset}px)` },
            { opacity: 1, transform: "translateX(0)" },
          ],
          { duration: 180, easing: "ease-out" }
        );
      }
      return { el, side, anchor: (y1 + y2) / 2 };
    });

    // 撑一条细线在栏的靠图一侧，标出该条弹幕对应的原文纵向位置
    const markers = items.map(({ side, anchor }) => {
      const mark = markInjected(document.createElement("div"));
      mark.className = `${MARKER_CLASS} notranslate`;
      mark.style.cssText = [
        "position:absolute",
        "width:4px",
        "height:2px",
        "border-radius:1px",
        "background:rgba(240,69,126,0.6)",
        side === "left" ? "right:-6px" : "left:-6px",
      ].join(";");
      gutters[side].appendChild(mark);
      return { mark, anchor, side };
    });

    // 可滚动栏两端的低调提示：一小条渐隐 + 迷你三角，只在该方向还有未看内容时出现。
    // 挂在 gutter 外面（同一个定位父容器里），这样它不随内容滚动、始终钉在栏的顶端/底端。
    const makeScrollHint = (edge) => {
      const el = markInjected(document.createElement("div"));
      el.className = `${HINT_CLASS} notranslate`;
      el.style.cssText = [
        "position:absolute",
        `width:${gutterWidth}px`,
        `height:${SCROLL_HINT_HEIGHT}px`,
        "display:none",
        "pointer-events:none",
        "z-index:11",
        edge === "top"
          ? "background:linear-gradient(rgba(253,247,250,0.92), rgba(253,247,250,0))"
          : "background:linear-gradient(rgba(253,247,250,0), rgba(253,247,250,0.92))",
      ].join(";");
      const caret = document.createElement("span");
      caret.textContent = edge === "top" ? "▴" : "▾";
      caret.style.cssText = [
        "position:absolute",
        "left:50%",
        "transform:translateX(-50%)",
        edge === "top" ? "top:2px" : "bottom:2px",
        "font-size:10px",
        "line-height:1",
        "color:rgba(233,61,130,0.85)",
      ].join(";");
      el.appendChild(caret);
      parent.appendChild(el);
      return el;
    };
    const hints = {
      left: { top: makeScrollHint("top"), bottom: makeScrollHint("bottom") },
      right: { top: makeScrollHint("top"), bottom: makeScrollHint("bottom") },
    };

    // 各栏是否处于「爆满可滚动」状态；状态翻转时要重排一次
    // （滚动条会吃掉栏内宽度，译文块随之换行、高度变化）
    const scrollable = { left: false, right: false };

    const updateHints = (side) => {
      const gutter = gutters[side];
      const canScroll = scrollable[side] && gutter.style.display !== "none";
      const showTop = canScroll && gutter.scrollTop > SCROLL_HINT_THRESHOLD;
      const showBottom =
        canScroll &&
        gutter.scrollTop <
          gutter.scrollHeight - gutter.clientHeight - SCROLL_HINT_THRESHOLD;
      hints[side].top.style.display = showTop ? "" : "none";
      hints[side].bottom.style.display = showBottom ? "" : "none";
    };

    Object.keys(gutters).forEach((side) => {
      gutters[side].addEventListener("scroll", () => updateHints(side), {
        passive: true,
      });
    });

    const setScrollable = (side, on) => {
      const gutter = gutters[side];
      gutter.style.overflowY = on ? "auto" : "visible";
      // 可滚动时栏位要接收滚轮/拖拽事件；平时保持穿透，不挡页面
      gutter.style.pointerEvents = on ? "auto" : "none";
      gutter.style.overscrollBehavior = on ? "contain" : "";
      gutter.style.scrollbarWidth = on ? "thin" : "";
      // 滚动盒会裁掉栏外的内容，原贴在栏外的位置标记改为贴栏内边缘
      markers
        .filter((m) => m.side === side)
        .forEach(({ mark }) => {
          const prop = side === "left" ? "right" : "left";
          mark.style[prop] = on ? "0px" : "-6px";
        });
      updateHints(side);
    };

    const sync = () => {
      const renderedHeight = img.clientHeight || img.offsetHeight;
      const containerWidth = parent.clientWidth || parentWidth;
      // 栏位贴容器左右边缘（而不是贴着图片），这样同一页里宽度不同的图片
      // 译文列始终在同一条竖线上。
      gutters.left.style.top = `${img.offsetTop}px`;
      gutters.left.style.height = `${img.offsetHeight}px`;
      gutters.left.style.left = "0px";
      gutters.right.style.top = `${img.offsetTop}px`;
      gutters.right.style.height = `${img.offsetHeight}px`;
      gutters.right.style.left = `${Math.max(containerWidth - gutterWidth, 0)}px`;

      // 滚动提示钉在栏位两端（不随内容滚动），位置跟栏位走
      ["left", "right"].forEach((side) => {
        const hintLeft =
          side === "left" ? 0 : Math.max(containerWidth - gutterWidth, 0);
        hints[side].top.style.top = `${img.offsetTop}px`;
        hints[side].top.style.left = `${hintLeft}px`;
        hints[side].bottom.style.top = `${
          img.offsetTop + img.offsetHeight - SCROLL_HINT_HEIGHT
        }px`;
        hints[side].bottom.style.left = `${hintLeft}px`;
      });

      // 逐栏堆积：先按锚点（原文纵向中心）排序，再依次下推，保证互不重叠。
      ["left", "right"].forEach((side) => {
        const sideItems = items
          .filter((item) => item.side === side)
          .sort((a, b) => a.anchor - b.anchor);
        // 最多排两遍：最后一枚译文块底部超出栏高即「爆满」；滚动条出现会改变
        // 栏内宽度与译文块高度，状态翻转后再排一遍
        for (let pass = 0; pass < 2; pass++) {
          let bottom = Number.NEGATIVE_INFINITY;
          sideItems.forEach((item) => {
            const chipH = item.el.offsetHeight || DANMAKU_FONT_SIZE * 1.6;
            const centered =
              (item.anchor / naturalHeight) * renderedHeight - chipH / 2;
            const top = Math.max(centered, bottom + DANMAKU_GAP);
            item.el.style.top = `${top}px`;
            bottom = top + chipH;
          });
          // 1px 容差：防止亚像素取整导致状态来回抖动
          const overflowing = bottom > renderedHeight + 1;
          if (overflowing === scrollable[side]) break;
          scrollable[side] = overflowing;
          setScrollable(side, overflowing);
        }
      });

      markers.forEach(({ mark, anchor }) => {
        mark.style.top = `${(anchor / naturalHeight) * renderedHeight - 1}px`;
      });

      Object.keys(gutters).forEach(updateHints);
    };

    sync();

    return {
      sync,
      setVisible(visible) {
        Object.values(gutters).forEach((el) => {
          el.style.display = visible ? "" : "none";
        });
        Object.values(hints)
          .flatMap((pair) => [pair.top, pair.bottom])
          .forEach((el) => {
            if (!visible) el.style.display = "none";
          });
        if (visible) Object.keys(gutters).forEach(updateHints);
        // 弹幕模式靠「压窄图片 + 两侧腾栏」实现，隐藏时必须把图片放回原尺寸，
        // 否则「原图」模式会留下一张被压窄的图
        if (visible) {
          applyNarrow();
          sync();
        } else {
          restoreImage();
        }
      },
      destroy() {
        Object.values(gutters).forEach((el) => el.remove());
        Object.values(hints)
          .flatMap((pair) => [pair.top, pair.bottom])
          .forEach((el) => el.remove());
        restoreImage();
      },
    };
  };

  /**
   * 按显示方式在图片上挂载译文层，并支持运行时切换模式。
   * @param {HTMLImageElement} img
   * @param {Object} params bubbles / naturalWidth / naturalHeight / mode
   * @returns {Object|null} `{mode, setMode, sync, setVisible, destroy}`
   */
  const attachMangaLayer = (
    img,
    { bubbles = [], naturalWidth = 0, naturalHeight = 0, mode = MODE_MANGA_OVERLAY } = {}
  ) => {
    const parent = img.parentElement;
    if (!parent || !naturalWidth || !naturalHeight) return null;

    // 只有父容器原本是 static 时才改成 relative，并记住原值以便恢复
    const originalPosition = parent.style.position;
    const positionedByUs = getComputedStyle(parent).position === "static";
    if (positionedByUs) parent.style.setProperty("position", "relative");

    let visible = true;
    let currentMode = null;
    let handle = null;

    const build = (nextMode) => {
      handle?.destroy?.();
      currentMode = nextMode;
      handle =
        nextMode === MODE_MANGA_DANMAKU
          ? createGutters(img, { bubbles, naturalWidth, naturalHeight })
          : createOverlay(img, { bubbles, naturalWidth, naturalHeight });
      handle?.setVisible?.(visible);
    };

    build(mode);

    return {
      get mode() {
        return currentMode;
      },
      setMode(nextMode) {
        if (nextMode && nextMode !== currentMode) build(nextMode);
      },
      sync() {
        handle?.sync?.();
      },
      setVisible(next) {
        visible = next;
        handle?.setVisible?.(next);
      },
      destroy() {
        handle?.destroy?.();
        handle = null;
        // 只恢复由本模块改写的父容器定位样式
        if (positionedByUs && parent.style.position === "relative") {
          if (originalPosition) parent.style.setProperty("position", originalPosition);
          else parent.style.removeProperty("position");
        }
      },
    };
  };

  const TOGGLE_LABELS = {
    [MODE_MANGA_OVERLAY]: "漫",
    [MODE_MANGA_DANMAKU]: "幕",
    [TOGGLE_STATE_OFF]: "原",
  };

  // 三种状态的按钮配色：嵌字=白玻璃底品红字、弹幕=品红底白字（主操作高亮）、原图=灰
  const TOGGLE_STYLES = {
    [MODE_MANGA_OVERLAY]: {
      backgroundColor: "rgba(255,255,255,0.88)",
      backgroundImage: "none",
      color: "#E93D82",
    },
    [MODE_MANGA_DANMAKU]: {
      backgroundColor: "#F0457E",
      backgroundImage: "linear-gradient(135deg, #FFB7D5 0%, #F0457E 100%)",
      color: "#FFFFFF",
    },
    [TOGGLE_STATE_OFF]: {
      backgroundColor: "rgba(140,140,140,0.8)",
      backgroundImage: "none",
      color: "#FFFFFF",
    },
  };

  /**
   * 挂载页面右下角的漫画翻译悬浮开关。
   * @param {Object} params onClick 回调 / title 提示文案
   * @returns {Object} `{setState, destroy}`
   */
  const mountMangaToggle = ({ onClick, title = "" }) => {
    // 用原生 button 而不是 role=button 的 div：键盘可达（Tab + Enter）由浏览器保证
    const btn = markInjected(document.createElement("button"));
    btn.type = "button";
    btn.className = `${TOGGLE_CLASS} notranslate`;
    btn.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "width:44px",
      "height:44px",
      "border:0",
      "padding:0",
      "appearance:none",
      "border-radius:50%",
      "box-shadow:0 2px 8px rgba(0,0,0,0.28)",
      "backdrop-filter:blur(10px)",
      "-webkit-backdrop-filter:blur(10px)",
      "background:rgba(255,255,255,0.88)",
      "color:#E93D82",
      "font-size:18px",
      "line-height:1",
      "cursor:pointer",
      "user-select:none",
      "font-family:system-ui,-apple-system,sans-serif",
    ].join(";");
    if (title) btn.title = title;

    btn.addEventListener("click", onClick);
    (document.body || document.documentElement).appendChild(btn);

    return {
      /** `overlay` → 漫（嵌字）、`danmaku` → 幕（侧栏弹幕）、`off` → 原 */
      setState(state) {
        const style = TOGGLE_STYLES[state] || TOGGLE_STYLES[TOGGLE_STATE_OFF];
        btn.textContent = TOGGLE_LABELS[state] || TOGGLE_LABELS[TOGGLE_STATE_OFF];
        btn.dataset.state = state;
        btn.style.backgroundColor = style.backgroundColor;
        btn.style.backgroundImage = style.backgroundImage;
        btn.style.color = style.color;
      },
      destroy() {
        btn.remove();
      },
    };
  };

  Transelle.mangaOverlay = {
    MODE_MANGA_OVERLAY,
    MODE_MANGA_DANMAKU,
    TOGGLE_STATE_OFF,
    attachMangaLayer,
    mountMangaToggle,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
