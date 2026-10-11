/**
 * @file ja.js
 * @description 日语（尤其二次元 / 轻小说 / 游戏文本）专用设置的**外部注入**。
 *
 * 同 `seed.js` 的思路：文件放在扩展根目录，**不入库、不进发布包**——只有本机存在时
 * 才生效；从 GitHub 克隆或商店安装的副本拿不到它们，扩展照常工作。
 *
 * **多份配置可以共存**，按下面的顺序合并（后面的覆盖前面的同名词条）：
 *   local-ja.json        通用日语 / 二次元（提示词 + 术语表 + 罗马音开关）
 *   local-ja-terms.json  术语表扩充
 *   local-ja-names.json  人名、角色名、标签名
 *   local-ja-adult.json  成人内容领域的专门术语（单独放，便于自己管理）
 * 另外任何一份都可以用 `"imports": ["别的文件名.json"]` 再引入任意文件。
 *
 * 每份文件的形状：
 * ```json
 * { "enabled": true, "prompt": "…补充要求…", "terms": "原文,译文\n…", "romaji": true }
 * ```
 * 缺失、解析失败、`enabled: false` 的文件一律跳过；全都读不到时返回 null。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.ja) return;

  const FILES = [
    "local-ja.json",
    "local-ja-terms.json",
    "local-ja-names.json",
    "local-ja-adult.json",
  ];

  let cached; // undefined = 未读；object = 读过的合并结果（可能为 null）

  const readOne = async (name) => {
    try {
      const res = await fetch(chrome.runtime.getURL(name), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object" || data.enabled === false) return null;
      return data;
    } catch {
      return null; // 文件不存在（商店安装的副本）就静默跳过
    }
  };

  /** 依次读：先固定的几份，再按各文件里 imports 声明的补充文件（只展开一层） */
  const loadAll = async () => {
    const parts = [];
    const seen = new Set();
    const queue = [...FILES];

    while (queue.length) {
      const name = queue.shift();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const data = await readOne(name);
      if (!data) continue;
      parts.push(data);
      if (Array.isArray(data.imports)) {
        data.imports.forEach((extra) => {
          if (typeof extra === "string" && extra.endsWith(".json")) queue.push(extra);
        });
      }
    }

    if (!parts.length) return null;

    let romaji = true; // 默认开启：难译 / 无意义的假名转罗马音呈现
    for (const p of parts) {
      if (typeof p.romaji === "boolean") romaji = p.romaji;
    }

    return {
      files: [...seen],
      prompt: parts.map((p) => String(p.prompt || "")).filter(Boolean).join("\n\n"),
      // 术语按读到顺序拼接：后出现的同名词条覆盖先出现的（parseTerms 后者取胜）
      terms: parts.map((p) => String(p.terms || "")).filter(Boolean).join("\n"),
      romaji,
    };
  };

  Transelle.ja = {
    files: FILES,

    /** 忘掉缓存，下次重新读文件（改完配置文件后可调用） */
    reset() {
      cached = undefined;
    },

    /**
     * 取合并后的日语补充设置。
     * @returns {Promise<{prompt: string, terms: string, romaji: boolean, files: string[]}|null>}
     */
    async get() {
      if (cached === undefined) cached = await loadAll();
      return cached;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
