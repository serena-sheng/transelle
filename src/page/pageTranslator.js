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
  const FAST_BATCH_SIZE = 20; // 免费机翻一次带的条数（端点支持多条 q）
  const FAST_CONCURRENCY = 4; // 机翻并发（别打太猛，免得被限流）
  const MUTATION_DEBOUNCE = 600; // 动态内容补翻的防抖时间

  // 流式增量：background 每译好一条就推回一个 TRANSLATE_DELTA，按 batchId 路由到对应批次
  const deltaHandlers = new Map(); // batchId -> (index, text) => void
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== Transelle.MSG.TRANSLATE_DELTA) return;
      deltaHandlers.get(message.batchId)?.(message.index, message.text);
    });
  }

  const createPageTranslator = () => {
    let running = false;
    let busy = false;
    let rule = { ...Transelle.DEFAULT_RULE };
    let toLang = "zh-CN";
    const cache = new Map(); // 文本哈希 -> 译文
    let observer = null;
    let progressCb = null;
    let epoch = 0; // 每次 start/stop 自增；在飞的批次据此判断自己是否已过期
    let batchSeq = 0; // 批次编号，用于把流式增量路由回对应批次
    let routing = { enabled: true, fast: "google" }; // 是否按内容权重把边角降级到机翻

    const report = (payload) => {
      try {
        progressCb?.(payload);
      } catch {
        // 进度回调不该影响翻译流程
      }
    };

    /**
     * 按内容权重分两档翻译：`deep`（正文）走精翻引擎，`fast`（边角）走免费机翻。
     * 分档在 collector 里定好（见 weight.js）。两档各自并发，互不等待。
     * @param {Array<{node: Text, text: string, tier: "deep"|"fast"}>} items
     * @param {(node: Text, translated: string) => void} onResult
     */
    const translateAll = async (items, onResult) => {
      const total = items.length;
      let done = 0;

      // 按「文本哈希」归组：同一段文本出现多次只请求一次，但所有节点都要回填
      const groups = new Map(); // key -> { text, key, nodes: Text[], tier }
      items.forEach(({ node, text, tier }) => {
        const key = Transelle.hash(text);
        if (cache.has(key)) {
          onResult(node, cache.get(key)); // 缓存命中：立刻渲染，不占进度等待
          done++;
          return;
        }
        const group = groups.get(key);
        if (group) {
          group.nodes.push(node);
          if (tier === "deep") group.tier = "deep"; // 只要有一处算正文，整段就精翻
        } else {
          groups.set(key, {
            text,
            key,
            nodes: [node],
            tier: tier === "fast" ? "fast" : "deep",
          });
        }
      });

      // 同一节点只渲染一次：流式已推过的，整批返回时不再重复注入
      const emitted = new Set();
      const emit = (node, text) => {
        if (emitted.has(node)) return;
        emitted.add(node);
        onResult(node, text);
      };
      const finish = (unit, text) => {
        const value = typeof text === "string" && text.trim() ? text : unit.text;
        cache.set(unit.key, value);
        unit.nodes.forEach((n) => emit(n, value));
      };

      const all = [...groups.values()];
      const useRouting = routing?.enabled !== false;
      const deepUnits = useRouting ? all.filter((u) => u.tier === "deep") : all;
      const fastUnits = useRouting ? all.filter((u) => u.tier === "fast") : [];

      report({ phase: "progress", done, total });

      /** 通用并发池：把 units 切成 size 大小的块，用 concurrency 个 worker 跑 */
      const runPool = async (units, size, concurrency, handler) => {
        const chunks = [];
        for (let i = 0; i < units.length; i += size) chunks.push(units.slice(i, i + size));
        let next = 0;
        const worker = async () => {
          while (next < chunks.length) {
            const chunk = chunks[next++];
            try {
              await handler(chunk);
            } catch (err) {
              Transelle.log.error("翻译批次失败:", err?.message || err);
              report({ phase: "error", message: `翻译失败：${err?.message || err}` });
            }
            done += chunk.reduce((n, u) => n + u.nodes.length, 0);
            report({ phase: "progress", done, total });
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(concurrency, chunks.length) }, worker)
        );
      };

      // 正文：精翻（流式，边生成边回填）
      const deepHandler = async (batch) => {
        const texts = batch.map((u) => u.text);
        const batchId = `b${batchSeq++}`;
        deltaHandlers.set(batchId, (index, text) => {
          const unit = batch[index];
          if (unit) finish(unit, text);
        });
        try {
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE, {
            texts,
            toLang,
            rule: { terms: rule.terms, prompt: rule.prompt },
            batchId,
          });
          batch.forEach((unit, idx) => finish(unit, translated[idx]));
        } finally {
          deltaHandlers.delete(batchId);
        }
      };

      // 边角：免费机翻；机翻不可用时退回精翻，保证页面仍被翻译（这一次不省）
      const fastHandler = async (batch) => {
        const texts = batch.map((u) => u.text);
        try {
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE_FAST, {
            texts,
            toLang,
            provider: routing?.fast || "google",
          });
          batch.forEach((unit, idx) => finish(unit, translated[idx]));
        } catch (err) {
          Transelle.log.warn("机翻失败，该批退回精翻:", err?.message || err);
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE, {
            texts,
            toLang,
            rule: { terms: rule.terms, prompt: rule.prompt },
          });
          batch.forEach((unit, idx) => finish(unit, translated[idx]));
        }
      };

      await Promise.all([
        runPool(deepUnits, BATCH_SIZE, CONCURRENCY, deepHandler),
        runPool(fastUnits, FAST_BATCH_SIZE, FAST_CONCURRENCY, fastHandler),
      ]);
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

      async start({ rule: nextRule, toLang: nextToLang, routing: nextRouting } = {}) {
        if (nextRule) rule = { ...Transelle.DEFAULT_RULE, ...nextRule };
        if (nextToLang) toLang = nextToLang;
        if (nextRouting) routing = { ...routing, ...nextRouting };
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
