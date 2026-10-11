/**
 * @file mangaTranslator.js
 * @description 漫画图片翻译主控。
 *
 * 流程：发现尺寸达标的图片 → 进入视口才处理 → 取图转 base64 → 按需缩放 →
 * 交给视觉模型拿气泡坐标与译文 → 交给 overlay 渲染 → 按 URL 缓存避免重复请求。
 *
 * 显示方式三态由悬浮开关循环切换：嵌字 → 侧栏弹幕 → 原图。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.mangaTranslator) return;

  const { MODE_MANGA_OVERLAY, MODE_MANGA_DANMAKU, TOGGLE_STATE_OFF } =
    Transelle.mangaOverlay;

  const MIN_IMAGE_EDGE = 300; // 小于该边长的图视为图标/装饰，跳过
  const MAX_SEND_WIDTH = 1300; // 发送前压到的最大宽度（视觉模型内部长边上限约 1300，再大只是白烧带宽）
  const JPEG_QUALITY = 0.85;
  const MAX_CONCURRENT = 2; // 同时在跑的视觉请求数
  const ROOT_MARGIN = "300px 0px"; // 视口预取范围：只给纵向留提前量
  const IMAGE_LOAD_TIMEOUT = 15000;
  const CACHE_SAVE_DELAY = 1000;
  const CACHE_MAX = 200;

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片解码失败"));
      image.src = src;
    });

  const createMangaTranslator = () => {
    let started = false;
    let rule = { ...Transelle.DEFAULT_RULE };
    let settings = null;
    let mode = MODE_MANGA_OVERLAY;
    let systemPrompt = Transelle.mangaPrompt.BASE_PROMPT;
    let promptSig = "";

    const states = new Map(); // img -> { url, layer }
    const queue = [];
    let active = 0;

    let io = null;
    let mo = null;
    let toggle = null;
    let mutationsTimer = null;
    const pendingRoots = new Set();

    // --- 缓存（内存 + 落盘） ---
    let cache = {};
    let cacheLoaded = false;
    let cacheSaveTimer = null;

    const cacheKeyOf = (url) => `${Transelle.hash(url)}|${promptSig}`;

    const loadCache = async () => {
      if (cacheLoaded) return;
      try {
        const store = await chrome.storage.local.get(Transelle.MANGA_CACHE_KEY);
        cache = store[Transelle.MANGA_CACHE_KEY] || {};
      } catch {
        cache = {};
      }
      cacheLoaded = true;
    };

    const flushCache = () => {
      if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
      cacheSaveTimer = setTimeout(() => {
        cacheSaveTimer = null;
        // 超出上限时按时间戳淘汰最旧的一批，避免存储无限膨胀
        const entries = Object.entries(cache);
        if (entries.length > CACHE_MAX) {
          entries
            .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
            .slice(0, entries.length - CACHE_MAX)
            .forEach(([key]) => delete cache[key]);
        }
        chrome.storage.local
          .set({ [Transelle.MANGA_CACHE_KEY]: cache })
          .catch(() => {});
      }, CACHE_SAVE_DELAY);
    };

    // --- 取图 ---
    const drawToDataUrl = (img) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      } catch {
        // 跨域图片会污染 canvas，取不到就放弃（代理通道通常已经拿到图）
        return null;
      }
    };

    const resolveImageDataUrl = async (img, url) => {
      // 优先走 background 代理：不受页面 CORS 限制，也不会污染 canvas
      try {
        return await Transelle.send(Transelle.MSG.FETCH_IMAGE, { url });
      } catch (err) {
        Transelle.log.warn("代理取图失败，回退 canvas:", err.message);
      }
      return drawToDataUrl(img);
    };

    /** 过宽的图先缩放再发送，控制带宽与模型输入尺寸；返回的是「发送尺寸」 */
    const shrink = async (dataUrl) => {
      const image = await loadImage(dataUrl);
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      if (w <= MAX_SEND_WIDTH) return { dataUrl, width: w, height: h };

      const nw = MAX_SEND_WIDTH;
      const nh = Math.round((h / w) * MAX_SEND_WIDTH);
      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      canvas.getContext("2d").drawImage(image, 0, 0, nw, nh);
      return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width: nw, height: nh };
    };

    const ensureImageLoaded = (img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = () => resolve(img.naturalWidth > 0);
        img.addEventListener("load", finish, { once: true });
        img.addEventListener("error", () => resolve(false), { once: true });
        setTimeout(() => resolve(img.naturalWidth > 0), IMAGE_LOAD_TIMEOUT);
      });
    };

    // --- 单张图片的完整处理 ---
    const processImage = async (img, url) => {
      await ensureImageLoaded(img);
      if (!img.isConnected) return;

      const { naturalWidth: w, naturalHeight: h } = img;
      if (w < MIN_IMAGE_EDGE || h < MIN_IMAGE_EDGE) return;

      const key = cacheKeyOf(url);
      let payload = cache[key];

      if (!payload) {
        const raw = await resolveImageDataUrl(img, url);
        if (!raw) return;
        const shrunk = await shrink(raw);
        const reply = await Transelle.send(Transelle.MSG.VISION, {
          imageDataUrl: shrunk.dataUrl,
          systemPrompt,
        });
        const bubbles = Transelle.mangaPrompt.parseVisionResult(reply, {
          width: shrunk.width,
          height: shrunk.height,
        });
        payload = { bubbles, width: shrunk.width, height: shrunk.height, ts: Date.now() };
        cache[key] = payload;
        flushCache();
      }

      if (!img.isConnected) return;

      // 已挂过层就先拆掉，避免同一张图叠两层
      const existing = states.get(img);
      if (existing?.layer) existing.layer.destroy();

      const layer = Transelle.mangaOverlay.attachMangaLayer(img, {
        bubbles: payload.bubbles,
        naturalWidth: payload.width,
        naturalHeight: payload.height,
        mode: mode === MODE_MANGA_DANMAKU ? MODE_MANGA_DANMAKU : MODE_MANGA_OVERLAY,
      });
      if (!layer) return;

      const visible = mode !== TOGGLE_STATE_OFF;
      layer.setVisible(visible);
      states.set(img, { url, layer });
    };

    // --- 队列：最多 2 个并发 ---
    const drainQueue = () => {
      while (active < MAX_CONCURRENT && queue.length) {
        const task = queue.shift();
        active++;
        processImage(task.img, task.url)
          .catch((err) => {
            Transelle.log.warn("漫画翻译失败:", task.url, err.message);
            warnOnce(`漫画翻译失败：${err.message}`);
          })
          .finally(() => {
            active--;
            drainQueue();
          });
      }
    };

    // 失败提示只弹一次：一页几十张图，每张都弹会把页面糊满
    let errorWarned = false;
    const warnOnce = (message) => {
      if (errorWarned) return;
      errorWarned = true;
      Transelle.renderer.toast(message, "error");
    };

    const enqueue = (img) => {
      const url = img.currentSrc || img.src;
      if (!url) return;
      const state = states.get(img);
      if (state?.url === url) return; // 同一张图已处理过
      if (state) {
        state.layer?.destroy();
        states.delete(img);
      }
      queue.push({ img, url });
      drainQueue();
    };

    const observeImages = (scope) => {
      if (!io || !scope?.querySelectorAll) return;
      if (scope.nodeName === "IMG") {
        io.observe(scope);
        return;
      }
      scope.querySelectorAll("img").forEach((img) => io.observe(img));
    };

    const handleIntersect = (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        enqueue(entry.target);
      });
    };

    const flushMutated = () => {
      if (!started || !pendingRoots.size) return;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      roots.forEach((node) => {
        // 节点可能已被移除
        if (node.isConnected) observeImages(node);
      });
    };

    const handleMutations = (mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          // 翻页常直接替换 img.src
          if (mutation.target?.nodeName === "IMG") pendingRoots.add(mutation.target);
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) pendingRoots.add(node);
        });
      });
      if (mutationsTimer) return;
      mutationsTimer = setTimeout(() => {
        mutationsTimer = null;
        flushMutated();
      }, 300);
    };

    // --- 显示方式 ---
    const persistMode = (next) => {
      if (!settings) return;
      settings = {
        ...settings,
        manga: { ...settings.manga, mode: next },
      };
      Transelle.settings.save(settings).catch(() => {});
    };

    const applyMode = (next) => {
      mode = next;
      const visible = next !== TOGGLE_STATE_OFF;
      const layerMode =
        next === MODE_MANGA_DANMAKU ? MODE_MANGA_DANMAKU : MODE_MANGA_OVERLAY;
      states.forEach(({ layer }) => {
        layer.setMode(layerMode);
        layer.setVisible(visible);
      });
      toggle?.setState(next);
      persistMode(next);
    };

    const cycle = () => {
      const order = [MODE_MANGA_OVERLAY, MODE_MANGA_DANMAKU, TOGGLE_STATE_OFF];
      const idx = order.indexOf(mode);
      applyMode(order[(idx + 1) % order.length]);
    };

    return {
      isStarted: () => started,

      start({ rule: nextRule, settings: nextSettings, mode: initialMode } = {}) {
        if (started) return;
        started = true;

        if (nextRule) rule = { ...Transelle.DEFAULT_RULE, ...nextRule };
        if (nextSettings) settings = nextSettings;

        systemPrompt = Transelle.mangaPrompt.buildVisionPrompt({
          prompt: rule.prompt,
          terms: rule.terms,
        });
        // 提示词签名参与缓存键：站点术语表/提示词变了，旧缓存自动失效
        promptSig = Transelle.hash(systemPrompt);
        loadCache();

        mode =
          initialMode === MODE_MANGA_DANMAKU || initialMode === TOGGLE_STATE_OFF
            ? initialMode
            : MODE_MANGA_OVERLAY;

        toggle = Transelle.mangaOverlay.mountMangaToggle({
          onClick: cycle,
          title: "漫画翻译：嵌字 / 弹幕 / 原图",
        });
        toggle.setState(mode);

        io = new IntersectionObserver(handleIntersect, { rootMargin: ROOT_MARGIN });
        mo = new MutationObserver(handleMutations);
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });

        observeImages(document);
      },

      stop() {
        if (!started) return;
        started = false;

        io?.disconnect();
        mo?.disconnect();
        io = null;
        mo = null;
        if (mutationsTimer) {
          clearTimeout(mutationsTimer);
          mutationsTimer = null;
        }
        pendingRoots.clear();
        queue.length = 0;
        active = 0;

        states.forEach(({ layer }) => layer?.destroy?.());
        states.clear();

        toggle?.destroy();
        toggle = null;

        Transelle.renderer.clear?.();
      },

      /** 外部改了规则/引擎后重建（术语表变化需要让缓存失效） */
      refreshPrompt(nextRule) {
        if (nextRule) rule = { ...Transelle.DEFAULT_RULE, ...nextRule };
        systemPrompt = Transelle.mangaPrompt.buildVisionPrompt({
          prompt: rule.prompt,
          terms: rule.terms,
        });
        promptSig = Transelle.hash(systemPrompt);
      },
    };
  };

  Transelle.mangaTranslator = createMangaTranslator();
})(typeof globalThis !== "undefined" ? globalThis : self);
