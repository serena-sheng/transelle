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

  // 小批次 + 高并发：模型是「逐字生成」的，把一批塞得太大等于让它在一条连接上
  // 串行吐完；拆成小批、多批同时在飞，首屏与整页耗时就都下来了。
  // DeepSeek flash 的账号级并发上限是 2500，这里默认 16 只是别把浏览器和网络打满。
  const BATCH_SIZE = 10; // 单次请求交给模型的文本条数
  const DEFAULT_CONCURRENCY = 16; // 并发的批次数（可在设置里改；DeepSeek flash 上限 2500）
  const MAX_CONCURRENCY = 64;
  const FAST_BATCH_SIZE = 20; // 免费机翻一次带的条数（端点支持多条 q）
  const FAST_CONCURRENCY = 8; // 机翻并发（别打太猛，免得被限流）
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
    // 待处理队列：新增内容 / 需要补翻的范围，串行处理，**绝不丢**（见下方 drain 注释）
    const queue = [];
    let draining = false;
    const rescanTimers = [];
    let rule = { ...Transelle.DEFAULT_RULE };
    let toLang = "zh-CN";
    const cache = new Map(); // 文本哈希 -> 译文
    let observer = null;
    let progressCb = null;
    let epoch = 0; // 每次 start/stop 自增；在飞的批次据此判断自己是否已过期
    let batchSeq = 0; // 批次编号，用于把流式增量路由回对应批次
    let routing = { enabled: true, fast: "google" }; // 是否按内容权重把边角降级到机翻
    let concurrency = DEFAULT_CONCURRENCY; // 正文精翻的并发批次数

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
          // 缓存命中：立刻渲染，不占进度等待。但若缓存的「译文」与原文实质相同
          // （机翻端点原样返回、只改了标点），就不注入。
          const cached = cache.get(key);
          if (!Transelle.sameText(cached, text)) onResult(node, cached);
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
        // 与原文相同（例如简体→简体）就不注入，避免页面上多出重复的一行
        if (Transelle.sameText(value, unit.text)) return;
        unit.nodes.forEach((n) => emit(n, value));
      };

      const all = [...groups.values()];
      const useRouting = routing?.enabled !== false;
      // 目标语言是中文时，中文互转（简体 ↔ 各类繁体）一律走免费机翻，且统一输出简体
      const zhTarget = /^zh/i.test(String(toLang || ""));
      const deepUnits = [];
      const freeGroups = new Map(); // "语言|类型" -> units[]
      const addFree = (key, unit) => {
        if (!freeGroups.has(key)) freeGroups.set(key, []);
        freeGroups.get(key).push(unit);
      };
      all.forEach((unit) => {
        const chinese = zhTarget && Transelle.isChinese(unit.text);
        if (chinese) addFree("zh-CN|zh", unit); // 中文互转：统一翻成简体
        else if (!useRouting || unit.tier === "deep") deepUnits.push(unit);
        else addFree(`${toLang}|fast`, unit);
      });

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

      // 免费机翻池（按目标语言分组）。allowFallback=false 的是中文互转：
      // 服务不可用时保留原文，不退回 DeepSeek（中文互转一律不走 DeepSeek）。
      const fastHandlerFor = (tl, allowFallback) => async (batch) => {
        const texts = batch.map((u) => u.text);

        // 优先用浏览器内置的设备内翻译：不走网络、免费、延迟接近零。
        // 语言包还没下好时 pick() 返回 null，会自动落到下面的免费机翻。
        if ((routing?.fast || "ondevice") === "ondevice" && Transelle.onDevice) {
          try {
            const picked = await Transelle.onDevice.pick(texts, tl);
            if (picked) {
              const translated = await Transelle.onDevice.translate(texts, picked);
              batch.forEach((unit, idx) => finish(unit, translated[idx]));
              return;
            }
          } catch (err) {
            Transelle.log.warn("设备内置翻译失败，回退机翻:", err?.message || err);
          }
        }

        try {
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE_FAST, {
            texts,
            toLang: tl,
            // "ondevice" 只是「优先设备内」，真正发出去的时候还是走免费机翻端点
            provider: routing?.fast === "ondevice" ? "google" : routing?.fast || "google",
          });
          batch.forEach((unit, idx) => finish(unit, translated[idx]));
        } catch (err) {
          Transelle.log.warn("机翻失败:", err?.message || err);
          if (!allowFallback) return; // 中文互转：保留原文即可
          const translated = await Transelle.send(Transelle.MSG.TRANSLATE, {
            texts,
            toLang: tl,
            rule: { terms: rule.terms, prompt: rule.prompt },
          });
          batch.forEach((unit, idx) => finish(unit, translated[idx]));
        }
      };

      const runs = [runPool(deepUnits, BATCH_SIZE, concurrency, deepHandler)];
      freeGroups.forEach((units, key) => {
        const [tl, kind] = key.split("|");
        runs.push(
          runPool(units, FAST_BATCH_SIZE, FAST_CONCURRENCY, fastHandlerFor(tl, kind !== "zh"))
        );
      });
      await Promise.all(runs);
    };

    const runOnce = async (scope) => {
      const myEpoch = epoch;
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
    };

    /**
     * 串行处理队列。**只延迟、绝不丢弃**——
     * 旧实现用 Set + `busy` 直接 return，正在排队的内容会被永久漏掉：
     * 首轮全页翻译很慢，期间页面「水合 / 懒加载」把顶部重新渲染，顶部进了队列
     * 又撞上 busy 被丢掉，从此不再重试（表现就是「下半段翻完了、上半段没翻」，
     * 滚动也救不回来）。现在改成排队等待，前一轮跑完自动接着处理。
     */
    const drain = async () => {
      if (!running || draining) return;
      draining = true;
      const myEpoch = epoch;
      try {
        while (running && epoch === myEpoch && queue.length) {
          const node = queue.shift();
          if (!node || !node.isConnected) continue; // 已被页面移除的跳过
          try {
            await runOnce(node);
          } catch (err) {
            // 单个区块失败不影响其它区块
            Transelle.log.error("翻译区块失败:", err?.message || err);
          }
        }
      } finally {
        draining = false;
      }
    };

    const enqueue = (node) => {
      queue.push(node);
      drain().catch(() => {});
    };

    // 新增内容多的时候攒一下再处理（防抖），但只是延迟，不丢
    const scheduleDrain = Transelle.debounce(() => {
      drain().catch(() => {});
    }, MUTATION_DEBOUNCE);

    const startObserver = () => {
      observer?.disconnect();
      observer = new MutationObserver((mutations) => {
        if (!running) return;
        let added = false;
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            // 我们自己注入的节点不算新内容
            if (node.dataset?.transelleSkip !== undefined) return;
            if (node.dataset?.transelleLayer) return;
            queue.push(node);
            added = true;
          });
        });
        if (added) scheduleDrain();
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

      async start({ rule: nextRule, toLang: nextToLang, routing: nextRouting, concurrency: nextConcurrency } = {}) {
        if (nextRule) rule = { ...Transelle.DEFAULT_RULE, ...nextRule };
        if (nextToLang) toLang = nextToLang;
        if (nextRouting) routing = { ...routing, ...nextRouting };
        const c = Number(nextConcurrency);
        if (Number.isFinite(c) && c > 0) {
          concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(c)));
        }
        if (running) return;

        running = true;
        epoch++;
        startObserver();
        // 不 await：整页翻译要几秒到几十秒，等它会让 popup 与页面交互一并卡住。
        enqueue(document);
        // 起始后再全页补扫两次：SPA 水合 / 懒加载常在这段时间把内容整个换掉，
        // 而首轮可能已经「跑过了」那一块。补扫很便宜——已翻过的段落命中缓存直接渲染。
        [1500, 5000].forEach((delay) => {
          rescanTimers.push(
            setTimeout(() => {
              if (running) enqueue(document);
            }, delay)
          );
        });
      },

      stop() {
        running = false;
        epoch++; // 作废在飞的批次：迟到的结果不再回填，取消即时生效
        observer?.disconnect();
        observer = null;
        queue.length = 0;
        rescanTimers.splice(0).forEach((t) => clearTimeout(t));
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
