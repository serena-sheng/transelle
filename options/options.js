/**
 * @file options.js
 * @description 设置页逻辑。原生 DOM，无框架。所有改动即时写入 chrome.storage。
 */
(function () {
  const T = globalThis.Transelle;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let settings = null;
  let toastTimer = null;

  const uid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
  };

  const save = () => {
    T.settings.save(settings).catch((err) => toast(`保存失败：${err.message}`));
  };

  const saveDebounced = T.debounce(() => {
    save();
    toast("已保存");
  }, 400);

  // ---------- 标签页 ----------
  const bindTabs = () => {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        const name = tab.dataset.tab;
        $$(".panel").forEach((p) =>
          p.classList.toggle("is-active", p.dataset.panel === name)
        );
      });
    });
  };

  // ---------- 引擎 ----------
  const engineTypeOptions = (selected) =>
    Object.entries(T.ENGINE_PRESETS)
      .map(
        ([type, preset]) =>
          `<option value="${type}"${type === selected ? " selected" : ""}>${preset.name}</option>`
      )
      .join("");

  const renderEngines = () => {
    const host = $("#engine-list");
    host.innerHTML = "";

    if (!settings.engines.length) {
      host.innerHTML = '<p class="hint">还没有引擎，点右上角「添加引擎」。</p>';
      renderEngineSelectors();
      return;
    }

    settings.engines.forEach((engine) => {
      const preset = T.ENGINE_PRESETS[engine.type] || T.ENGINE_PRESETS.custom;
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = engine.id;
      card.innerHTML = `
        <div class="card-head">
          <div class="card-title">
            <span class="eng-name"></span>
            <span class="pill">${preset.name}</span>
          </div>
          <button class="btn btn-danger" data-act="delete">删除</button>
        </div>
        <div class="grid2">
          <label class="field">
            <span class="label">类型</span>
            <select data-k="type">${engineTypeOptions(engine.type)}</select>
          </label>
          <label class="field">
            <span class="label">API Key${preset.needsKey ? "" : "（本地模型可不填）"}</span>
            <input type="password" data-k="apiKey" placeholder="${preset.needsKey ? "sk-..." : "无需填写"}" />
          </label>
        </div>
        <label class="field">
          <span class="label">Base URL</span>
          <input type="text" data-k="baseUrl" />
        </label>
        <label class="field">
          <span class="label">模型名（文本翻译用）</span>
          <input type="text" data-k="model" />
        </label>
        <div class="btn-row">
          <button class="btn" data-act="test">测试连接</button>
        </div>
        <div class="result" hidden></div>
      `;

      $(".eng-name", card).textContent = engine.name || preset.name;
      $('[data-k="baseUrl"]', card).value = engine.baseUrl || "";
      $('[data-k="model"]', card).value = engine.model || "";
      $('[data-k="apiKey"]', card).value = engine.apiKey || "";

      card.addEventListener("input", (e) => {
        const key = e.target.dataset.k;
        if (!key) return;
        engine[key] = e.target.value;
        saveDebounced();
      });

      card.addEventListener("change", (e) => {
        if (e.target.dataset.k !== "type") return;
        const nextType = e.target.value;
        const nextPreset = T.ENGINE_PRESETS[nextType];
        engine.type = nextType;
        // 换类型时把没改过的字段重置为预设，避免残留上一个引擎的地址
        engine.name = nextPreset.name;
        engine.baseUrl = nextPreset.baseUrl;
        engine.model = nextPreset.model || "";
        save();
        renderEngines();
      });

      card.addEventListener("click", async (e) => {
        const act = e.target.dataset.act;
        if (act === "delete") {
          settings.engines = settings.engines.filter((it) => it.id !== engine.id);
          if (settings.engineId === engine.id) {
            settings.engineId = settings.engines[0]?.id || "";
          }
          if (settings.visionEngineId === engine.id) settings.visionEngineId = "";
          save();
          renderEngines();
          renderEngineSelectors();
          toast("已删除引擎");
        }
        if (act === "test") {
          const box = $(".result", card);
          box.hidden = false;
          box.className = "result";
          box.textContent = "测试中…";
          try {
            const res = await T.send(T.MSG.TEST_ENGINE, { engine });
            box.className = "result ok";
            box.textContent = `连接正常（${res.ms}ms）\n返回：${res.sample || "(空)"}`;
          } catch (err) {
            box.className = "result err";
            box.textContent = `失败：${err.message}`;
          }
        }
      });

      host.appendChild(card);
    });

    renderEngineSelectors();
  };

  const renderEngineSelectors = () => {
    const pageSel = $("#page-engine");
    const mangaSel = $("#manga-engine");
    const options = settings.engines
      .map((e) => `<option value="${e.id}">${e.name || e.id}</option>`)
      .join("");

    pageSel.innerHTML = options || '<option value="">（无可用引擎）</option>';
    pageSel.value = settings.engineId || settings.engines[0]?.id || "";

    mangaSel.innerHTML =
      '<option value="">跟随网页翻译引擎</option>' + options;
    mangaSel.value = settings.visionEngineId || "";
  };

  // ---------- 网页翻译 ----------
  const renderPage = () => {
    const p = settings.page;
    $("#page-auto").checked = !!p.autoTranslate;
    $("#page-mode").value = p.mode;
    $("#page-tolang").value = p.toLang;
    $("#page-highlight").checked = !!p.highlight;
    const routing = (p.routing = p.routing || { enabled: true, fast: "google" });
    $("#page-routing").checked = routing.enabled !== false;
    $("#page-fast").value = routing.fast || "google";
    $("#page-concurrency").value = p.concurrency || 16;

    $("#page-auto").addEventListener("change", (e) => {
      p.autoTranslate = e.target.checked;
      saveDebounced();
    });
    $("#page-mode").addEventListener("change", (e) => {
      p.mode = e.target.value;
      saveDebounced();
    });
    $("#page-tolang").addEventListener("change", (e) => {
      p.toLang = e.target.value;
      saveDebounced();
    });
    $("#page-highlight").addEventListener("change", (e) => {
      p.highlight = e.target.checked;
      saveDebounced();
    });
    $("#page-routing").addEventListener("change", (e) => {
      p.routing = { ...routing, enabled: e.target.checked };
      saveDebounced();
    });
    $("#page-concurrency").addEventListener("change", (e) => {
      const n = Number(e.target.value);
      p.concurrency = Number.isFinite(n) ? Math.min(64, Math.max(1, Math.round(n))) : 16;
      e.target.value = p.concurrency;
      saveDebounced();
    });
    $("#page-fast").addEventListener("change", (e) => {
      p.routing = { ...routing, fast: e.target.value };
      saveDebounced();
    });
    $("#download-ondevice").addEventListener("click", async () => {
      const hint = $("#ondevice-hint");
      const btn = $("#download-ondevice");
      if (typeof Translator === "undefined") {
        hint.textContent = "这台浏览器不支持设备内置翻译（需要 Chrome 138+ 桌面版）。";
        return;
      }
      const MAP = { "zh-CN": "zh", "zh-TW": "zh-Hant", en: "en", ja: "ja", ko: "ko" };
      const target = MAP[p.toLang] || p.toLang;
      const sources = ["en", "ja", "ko", "zh-Hant"].filter((s) => s !== target);
      btn.disabled = true;
      try {
        for (const source of sources) {
          hint.textContent = `检查 ${source} → ${target} …`;
          const av = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
          if (av === "available") {
            hint.textContent = `${source} → ${target} 已就绪`;
            continue;
          }
          if (av === "unavailable") {
            hint.textContent = `${source} → ${target} 不支持`;
            continue;
          }
          await Translator.create({
            sourceLanguage: source,
            targetLanguage: target,
            monitor(m) {
              m.addEventListener("downloadprogress", (e) => {
                hint.textContent = `下载 ${source} → ${target}：${Math.round((e.loaded || 0) * 100)}%`;
              });
            },
          });
        }
        hint.textContent = "语言包已就绪：之后边角内容会优先走设备内翻译（不走网络）。";
      } catch (err) {
        hint.textContent = `下载失败：${err?.message || err}`;
      } finally {
        btn.disabled = false;
      }
    });
    $("#page-engine").addEventListener("change", (e) => {
      settings.engineId = e.target.value;
      saveDebounced();
    });
  };

  // ---------- 漫画翻译 ----------
  const renderManga = () => {
    const m = settings.manga;
    $("#manga-mode").value = m.mode;
    $("#manga-model").value = settings.visionModel || "";

    $("#manga-mode").addEventListener("change", (e) => {
      m.mode = e.target.value;
      saveDebounced();
    });
    $("#manga-engine").addEventListener("change", (e) => {
      settings.visionEngineId = e.target.value;
      saveDebounced();
    });
    $("#manga-model").addEventListener("input", (e) => {
      settings.visionModel = e.target.value.trim();
      saveDebounced();
    });
  };

  // ---------- 站点规则 ----------
  const renderRules = () => {
    const host = $("#rule-list");
    host.innerHTML = "";

    if (!settings.rules.length) {
      host.innerHTML =
        '<p class="hint">还没有规则。点右上角「添加规则」为特定站点定制译法与术语表。</p>';
      return;
    }

    settings.rules.forEach((rule, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div class="card-title">规则 ${idx + 1}</div>
          <button class="btn btn-danger" data-act="delete">删除</button>
        </div>
        <label class="field">
          <span class="label">匹配 pattern（逗号分隔，支持 * 通配）</span>
          <input type="text" data-k="pattern" placeholder="example.com" />
        </label>
        <div class="grid2">
          <label class="field">
            <span class="label">待翻译元素 selector（留空用默认）</span>
            <input type="text" data-k="selector" placeholder="article p, .content" />
          </label>
          <label class="field">
            <span class="label">忽略元素 ignoreSelector（留空用默认）</span>
            <input type="text" data-k="ignoreSelector" placeholder="nav, footer" />
          </label>
        </div>
        <div class="btn-row" style="margin-bottom:14px">
          <label class="field row" style="margin:0">
            <span>启用网页翻译</span>
            <input type="checkbox" data-k="pageEnabled" />
          </label>
          <label class="field row" style="margin:0">
            <span>启用漫画翻译</span>
            <input type="checkbox" data-k="mangaEnabled" />
          </label>
        </div>
        <label class="field">
          <span class="label">术语表（每行「原文,译文」）</span>
          <textarea data-k="terms" placeholder="the Fed,美联储"></textarea>
        </label>
        <label class="field">
          <span class="label">站点补充提示词</span>
          <textarea data-k="prompt" placeholder="你正在翻译……要求：……"></textarea>
        </label>
      `;

      $('[data-k="pattern"]', card).value = rule.pattern || "";
      $('[data-k="selector"]', card).value = rule.selector || "";
      $('[data-k="ignoreSelector"]', card).value = rule.ignoreSelector || "";
      $('[data-k="terms"]', card).value = rule.terms || "";
      $('[data-k="prompt"]', card).value = rule.prompt || "";
      $('[data-k="pageEnabled"]', card).checked = rule.pageEnabled !== false;
      $('[data-k="mangaEnabled"]', card).checked = rule.mangaEnabled === true;

      card.addEventListener("input", (e) => {
        const key = e.target.dataset.k;
        if (!key) return;
        rule[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
        saveDebounced();
      });
      card.addEventListener("change", (e) => {
        const key = e.target.dataset.k;
        if (key && e.target.type === "checkbox") {
          rule[key] = e.target.checked;
          saveDebounced();
        }
      });
      card.addEventListener("click", (e) => {
        if (e.target.dataset.act === "delete") {
          settings.rules.splice(idx, 1);
          save();
          renderRules();
          toast("已删除规则");
        }
      });

      host.appendChild(card);
    });
  };

  // ---------- 顶部按钮 ----------
  const bindActions = () => {
    $("#import-seed").addEventListener("click", async () => {
      try {
        const res = await T.seed.apply({ force: true });
        if (res.reason === "no-seed") {
          toast(`没找到 ${T.seed.file}，已跳过`);
          return;
        }
        settings = await T.settings.load();
        renderEngines();
        toast(res.applied ? `已导入 ${res.applied} 个引擎的 Key` : "Key 已是最新，未改动");
      } catch (err) {
        toast(`导入失败：${err.message}`);
      }
    });

    $("#add-engine").addEventListener("click", () => {
      const type = "custom";
      const preset = T.ENGINE_PRESETS[type];
      settings.engines.push({
        id: uid(),
        type,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: "",
        model: preset.model || "",
      });
      save();
      renderEngines();
      toast("已添加引擎");
    });

    $("#add-rule").addEventListener("click", () => {
      settings.rules.push({
        pattern: "",
        pageEnabled: true,
        mangaEnabled: false,
        selector: "",
        ignoreSelector: "",
        terms: "",
        prompt: "",
      });
      save();
      renderRules();
      // 新卡片在末尾，滚过去便于直接填
      $("#rule-list").lastElementChild?.scrollIntoView({ behavior: "smooth" });
    });

    $("#log-level").addEventListener("change", (e) => {
      settings.logLevel = e.target.value;
      T.setLogLevel(settings.logLevel);
      saveDebounced();
    });
  };

  const init = async () => {
    settings = await T.settings.load();
    T.setLogLevel(settings.logLevel);

    $("#about-version").textContent = chrome.runtime.getManifest().version;
    $("#log-level").value = settings.logLevel;

    bindTabs();
    renderEngines();
    renderPage();
    renderManga();
    renderRules();
    bindActions();
  };

  init().catch((err) => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<p class="hint" style="color:#d64545">设置加载失败：${err.message}</p>`
    );
  });
})();
