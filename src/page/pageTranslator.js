/**
 * @file pageTranslator.js
 * @description 网页整页翻译主控。
 *
 * 流程：收集文本节点 → 按批次发往 background → 回填缓存 → 注入译文。
 * 译文按「原文哈希」缓存，同一句在页面里出现多次只请求一次。
 * 页面动态加载的新内容由 MutationObserver 增量补翻。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.pageTranslator) return;

  const BATCH_SIZE = 20; // 单次请求交给模型的文本条数
  const MUTATION_DEBOUNCE = 600; // 动态内容补翻的防抖时间

  const createPageTranslator = () => {
    let running = false;
    let busy = false;
    let rule = { ...Transelle.DEFAULT_RULE };
    let toLang = "zh-CN";
    const cache = new Map(); // 文本哈希 -> 译文
    let observer = null;
    let progressCb = null;

    const report = (payload) => {
      try {
        progressCb?.(payload);
      } catch {
        // 进度回调不该影响翻译流程
      }
    };

    /** 先用缓存命中，剩下的按批请求 */
    const translateAll = async (items) => {
      const resolved = new Map(); // Text node -> 译文
      const pending = [];

      items.forEach(({ node, text }) => {
        const key = Transelle.hash(text);
        if (cache.has(key)) {
          resolved.set(node, cache.get(key));
        } else {
          pending.push({ node, text, key });
        }
      });

      const total = pending.length;
      let done = 0;

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const slice = pending.slice(i, i + BATCH_SIZE);
        const texts = slice.map((s) => s.text);
        try {
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE, {
            texts,
            toLang,
            rule: { terms: rule.terms, prompt: rule.prompt },
          });
          slice.forEach((item, idx) => {
            const value = translated[idx];
            // 模型返回空或长度不符时保留原文，避免出现空白
            const finalText =
              typeof value === "string" && value.trim() ? value : item.text;
            cache.set(item.key, finalText);
            resolved.set(item.node, finalText);
          });
        } catch (err) {
          Transelle.log.error("批量翻译失败:", err.message);
          // 报给界面：否则用户只会看到「点了没反应」
          report({ phase: "error", message: `翻译失败：${err.message}` });
          // 该批失败：不写缓存，节点保持原文，等待下次重试
          slice.forEach((item) => resolved.delete(item.node));
        }
        done += slice.length;
        report({ phase: "translating", done, total });
      }

      return resolved;
    };

    const runOnce = async (scope = document) => {
      if (!running || busy) return 0;
      busy = true;
      try {
        const items = Transelle.collector.collect(rule, scope);
        if (!items.length) return 0;

        report({ phase: "collecting", count: items.length });
        const resolved = await translateAll(items);

        let rendered = 0;
        resolved.forEach((translated, node) => {
          // 翻译期间节点可能已被页面移除或替换
          if (!node.isConnected) return;
          Transelle.renderer.render(node, translated);
          rendered++;
        });
        report({ phase: "done", rendered });
        return rendered;
      } finally {
        busy = false;
      }
    };

    const pendingRoots = new Set();

    const flushRoots = Transelle.debounce(async () => {
      if (!running || !pendingRoots.size) return;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      // 增量补翻：只处理新增子树，避免每次动态加载都全页重扫
      for (const node of roots) {
        if (node.isConnected) await runOnce(node);
      }
    }, MUTATION_DEBOUNCE);

    const startObserver = () => {
      observer?.disconnect();
      observer = new MutationObserver((mutations) => {
        if (!running) return;
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            // 我们自己注入的节点不算新内容
            if (node.dataset?.transelleSkip !== undefined) return;
            if (node.dataset?.transelleLayer) return;
            pendingRoots.add(node);
          });
        });
        if (pendingRoots.size) flushRoots();
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    };

    return {
      isRunning: () => running,

      setProgressListener(cb) {
        progressCb = cb;
      },

      async start({ rule: nextRule, toLang: nextToLang } = {}) {
        if (nextRule) rule = { ...Transelle.DEFAULT_RULE, ...nextRule };
        if (nextToLang) toLang = nextToLang;
        if (running) return;

        running = true;
        startObserver();
        await runOnce(document);
      },

      stop() {
        running = false;
        observer?.disconnect();
        observer = null;
        pendingRoots.clear();
        Transelle.renderer.clear();
      },

      /** 清空译文缓存（换引擎或改术语表后调用，避免旧译文复用） */
      clearCache() {
        cache.clear();
      },
    };
  };

  Transelle.pageTranslator = createPageTranslator();
})(typeof globalThis !== "undefined" ? globalThis : self);
