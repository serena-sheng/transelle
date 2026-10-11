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

  // 小批次 + 高并发：模型是「逐字生成」的，把 20 条塞进一次请求等于让它在一条
  // 连接上串行吐 20 条；拆成 10 条一批、6 批同时在飞，首屏与整页耗时就都下来了。
  const BATCH_SIZE = 10; // 单次请求交给模型的文本条数
  const CONCURRENCY = 6; // 同时在飞的批次数上限
  const MUTATION_DEBOUNCE = 600; // 动态内容补翻的防抖时间

  const createPageTranslator = () => {
    let running = false;
    let busy = false;
    let rule = { ...Transelle.DEFAULT_RULE };
    let toLang = "zh-CN";
    const cache = new Map(); // 文本哈希 -> 译文
    let observer = null;
    let progressCb = null;
    let epoch = 0; // 每次 start/stop 自增；在飞的批次据此判断自己是否已过期

    const report = (payload) => {
      try {
        progressCb?.(payload);
      } catch {
        // 进度回调不该影响翻译流程
      }
    };

    /**
     * 先用缓存命中，剩下的按批「并发」请求；每批一回来就回调渲染，
     * 于是译文会一段段出现，而不是等全页跑完才一起冒出来。
     * @param {Array<{node: Text, text: string}>} items
     * @param {(node: Text, translated: string) => void} onResult
     */
    const translateAll = async (items, onResult) => {
      const total = items.length;
      let done = 0;

      // 按「文本哈希」归组：同一段文本出现多次只请求一次，但所有节点都要回填
      const groups = new Map(); // key -> { text, key, nodes: Text[] }
      items.forEach(({ node, text }) => {
        const key = Transelle.hash(text);
        if (cache.has(key)) {
          onResult(node, cache.get(key)); // 缓存命中：立刻渲染，不占进度等待
          done++;
          return;
        }
        const group = groups.get(key);
        if (group) group.nodes.push(node);
        else groups.set(key, { text, key, nodes: [node] });
      });

      const units = [...groups.values()];
      const batches = [];
      for (let i = 0; i < units.length; i += BATCH_SIZE) {
        batches.push(units.slice(i, i + BATCH_SIZE));
      }

      report({ phase: "progress", done, total });

      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          const texts = batch.map((u) => u.text);
          try {
            const translated = await Transelle.send(Transelle.MSG.TRANSLATE, {
              texts,
              toLang,
              rule: { terms: rule.terms, prompt: rule.prompt },
            });
            batch.forEach((unit, idx) => {
              const value = translated[idx];
              // 模型返回空或长度不符时保留原文，避免出现空白
              const finalText =
                typeof value === "string" && value.trim() ? value : unit.text;
              cache.set(unit.key, finalText);
              unit.nodes.forEach((n) => onResult(n, finalText));
            });
          } catch (err) {
            Transelle.log.error("批量翻译失败:", err.message);
            // 报给界面：否则用户只会看到「点了没反应」
            report({ phase: "error", message: `翻译失败：${err.message}` });
            // 该批失败：不写缓存，节点保持原文，等待下次重试
          }
          done += batch.reduce((n, u) => n + u.nodes.length, 0);
          report({ phase: "progress", done, total });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker)
      );
    };

    const runOnce = async (scope = document) => {
      if (!running || busy) return 0;
      busy = true;
      const myEpoch = epoch;
      try {
        const items = Transelle.collector.collect(rule, scope);
        if (!items.length) return 0;

        report({ phase: "collecting", count: items.length });

        let rendered = 0;
        // 每段译好就当场注入，用户能看着页面一点点被译完
        await translateAll(items, (node, translated) => {
          // 翻译期间可能已被停止、或节点被页面移除/替换
          if (epoch !== myEpoch || !running || !node.isConnected) return;
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
        epoch++;
        startObserver();
        // 不 await：整页翻译要几秒到几十秒，等它会让 popup 与页面交互一并卡住。
        // 进度走 progressCb（content.js → renderer.progress），完成/失败也由它汇报。
        runOnce(document).catch((err) =>
          report({ phase: "error", message: `翻译失败：${err.message}` })
        );
      },

      stop() {
        running = false;
        epoch++; // 作废在飞的批次：迟到的结果不再回填，取消即时生效
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
