/**
 * @file ja.js
 * @description 日语（尤其二次元 / 轻小说 / 游戏文本）专用设置的**外部注入**。
 *
 * 同 `seed.js` 的思路：文件 `local-ja.json` 放在扩展根目录，**不入库、不进发布包**——
 * 只有本机存在时才生效；从 GitHub 克隆或商店安装的副本拿不到它，扩展照常工作。
 * 想改二次元译法，改这个文件即可，不必动插件代码、也不用重新发版。
 *
 * 文件形如：
 * ```json
 * {
 *   "enabled": true,
 *   "prompt": "…对日语原文的补充要求…",
 *   "terms": "原文,译文\n先輩,前辈\n…"
 * }
 * ```
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.ja) return;

  const FILE = "local-ja.json";
  let cached; // undefined = 还没读过；null = 没有/无效；object = 有效内容

  const read = async () => {
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(chrome.runtime.getURL(FILE), { cache: "no-store" });
      if (!res.ok) {
        cached = null;
        return null;
      }
      const data = await res.json();
      cached = data && typeof data === "object" ? data : null;
    } catch {
      cached = null; // 没有这个文件（商店安装的副本）就静默跳过
    }
    return cached;
  };

  Transelle.ja = {
    file: FILE,

    /** 忘掉缓存，下次重新读文件（设置页改完文件后可调用） */
    reset() {
      cached = undefined;
    },

    /**
     * 取日语补充设置。
     * @returns {Promise<{prompt: string, terms: string}|null>} 没有文件或已停用时返回 null
     */
    async get() {
      const data = await read();
      if (!data || data.enabled === false) return null;
      const prompt = String(data.prompt || "");
      const terms = String(data.terms || "");
      if (!prompt && !terms) return null;
      return { prompt, terms };
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
