/**
 * @file popup.js
 * @description 工具栏面板：查看当前页翻译状态、开关网页翻译、进设置。
 * 与 content script 通过消息通信；拿不到响应说明页面还没注入（刷新即可）。
 */
(function () {
  const T = globalThis.Transelle;
  const $ = (sel) => document.querySelector(sel);

  let tabId = null;

  const setText = (sel, text) => {
    $(sel).textContent = text;
  };

  const queryState = async () => {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: T.MSG.PAGE_STATE });
      if (!res?.ok) throw new Error(res?.error || "无响应");
      return res.data;
    } catch {
      return null;
    }
  };

  const render = (state) => {
    if (!state) {
      setText("#page-state", "未注入");
      setText("#manga-state", "—");
      setText("#rule-state", "—");
      $("#note").textContent = "此页面无法注入（浏览器内部页），或扩展刚重载过，刷新页面即可。";
      $("#toggle-page").disabled = true;
      return;
    }

    setText("#page-state", state.pageRunning ? "翻译中" : "已关闭");
    setText(
      "#manga-state",
      state.mangaEnabled ? (state.mangaStarted ? "已启用" : "规则已开") : "未启用"
    );
    setText("#rule-state", state.pattern || "默认规则");
    $("#toggle-page").textContent = state.pageRunning ? "取消翻译" : "翻译本页";
    $("#toggle-page").disabled = !state.pageEnabled;
    $("#note").textContent = state.pageEnabled
      ? ""
      : "当前站点规则已关闭网页翻译，可在设置里开启。";
  };

  const init = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;

    render(await queryState());

    $("#toggle-page").addEventListener("click", async () => {
      const btn = $("#toggle-page");
      btn.disabled = true;
      try {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: T.MSG.TOGGLE_PAGE,
        });
        if (!res?.ok) throw new Error(res?.error || "切换失败");
        render(await queryState());
      } catch (err) {
        $("#note").textContent = `操作失败：${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });

    $("#open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  };

  init().catch((err) => setText("#note", `初始化失败：${err.message}`));
})();
