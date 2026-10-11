/**
 * @file content.js
 * @description 内容脚本入口。装配设置与站点规则，按规则启动网页翻译 / 漫画翻译，
 * 并响应 popup 发来的开关指令。
 */
(function () {
  const Transelle = globalThis.Transelle;

  // 只处理普通网页；浏览器内部页、扩展页、about: 一律不碰
  if (!Transelle.isTranslatableUrl(location.href)) return;

  let settings = null;
  let rule = { ...Transelle.DEFAULT_RULE };

  const applyRenderOptions = () => {
    Transelle.renderer.setMode(settings.page.mode);
    Transelle.renderer.setHighlight(settings.page.highlight);
  };

  const startMangaIfNeeded = () => {
    if (!rule.mangaEnabled) return;
    if (Transelle.mangaTranslator.isStarted()) {
      Transelle.mangaTranslator.refreshPrompt(rule);
      return;
    }
    Transelle.mangaTranslator.start({
      rule,
      settings,
      mode: settings.manga.mode,
    });
  };

  const startPageTranslation = async () => {
    if (!rule.pageEnabled) return false;
    if (Transelle.pageTranslator.isRunning()) return true;
    applyRenderOptions();
    await Transelle.pageTranslator.start({
      rule,
      toLang: settings.page.toLang,
      routing: settings.page.routing,
    });
    return true;
  };

  const stopPageTranslation = () => {
    Transelle.pageTranslator.stop();
  };

  const bindProgress = () => {
    Transelle.pageTranslator.setProgressListener((event) => {
      const phase = event?.phase;
      if (phase === "error") {
        Transelle.renderer.progress(null);
        Transelle.renderer.toast(event.message, "error");
      } else if (phase === "collecting") {
        Transelle.renderer.progress(`翻译中 0/${event.count}`);
      } else if (phase === "progress" || phase === "translating") {
        Transelle.renderer.progress(`翻译中 ${event.done}/${event.total}`);
      } else if (phase === "done") {
        Transelle.renderer.progress(null);
        if (event.rendered) {
          Transelle.renderer.toast(`翻译完成 · ${event.rendered} 段`, "info");
        }
      }
    });
  };

  const boot = async () => {
    settings = await Transelle.settings.load();
    Transelle.setLogLevel(settings.logLevel);
    rule = Transelle.rules.forUrl(location.href, settings.rules);

    bindProgress();

    Transelle.log.debug("站点规则:", rule.pattern || "(默认)", {
      page: rule.pageEnabled,
      manga: rule.mangaEnabled,
    });

    startMangaIfNeeded();

    if (settings.page.autoTranslate) {
      await startPageTranslation();
    }
  };

  // --- 与 popup 的通信 ---
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;

    if (type === Transelle.MSG.PAGE_STATE) {
      sendResponse({
        ok: true,
        data: {
          pageRunning: Transelle.pageTranslator.isRunning(),
          mangaStarted: Transelle.mangaTranslator.isStarted(),
          mangaEnabled: rule.mangaEnabled,
          pageEnabled: rule.pageEnabled,
          pattern: rule.pattern,
        },
      });
      return false;
    }

    if (type === Transelle.MSG.TOGGLE_PAGE) {
      (async () => {
        try {
          if (Transelle.pageTranslator.isRunning()) {
            stopPageTranslation();
            sendResponse({ ok: true, data: { pageRunning: false } });
            return;
          }
          const ok = await startPageTranslation();
          sendResponse({ ok: true, data: { pageRunning: ok } });
        } catch (err) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
      })();
      return true; // 异步响应，保持通道
    }

    return false;
  });

  boot().catch((err) => Transelle.log.error("初始化失败:", err));
})();
