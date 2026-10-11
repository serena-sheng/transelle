/**
 * @file seed.js
 * @description 本机私密种子：把 local-seed.json 里的 Key 灌进设置，省去手输。
 *
 * 设计取舍：
 * - 种子文件与 manifest.json 同级，**不入库**（见 .gitignore）。从 GitHub 克隆的
 *   人不会有这个文件，fetch 失败即静默跳过，扩展照常手动填 Key。
 * - 只在首次生效（settings.seeded 为空时）。用户后来手动清空 Key，不该被种子灌回来；
 *   设置页的「重新导入」按钮走 force，才会覆盖。
 * - 只补不与已有 Key 冲突的引擎；没有的引擎按预设新建。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.seed) return;

  const SEED_FILE = "local-seed.json";

  /**
   * 读本机种子文件。文件不存在、不是 JSON、结构不对，一律当成「没有种子」。
   * @returns {Promise<Object|null>}
   */
  const read = async () => {
    try {
      const res = await fetch(chrome.runtime.getURL(SEED_FILE), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.engines)) return null;
      return data;
    } catch {
      return null;
    }
  };

  /**
   * 把种子里的 Key 写进设置。
   * @param {Object} [opts]
   * @param {boolean} [opts.force] 覆盖已填的 Key（设置页「重新导入」用）
   * @returns {Promise<{applied:number, reason:string}>}
   */
  const apply = async ({ force = false } = {}) => {
    const seed = await read();
    if (!seed) return { applied: 0, reason: "no-seed" };

    const settings = await Transelle.settings.load();
    if (settings.seeded && !force) return { applied: 0, reason: "already-seeded" };

    let applied = 0;
    seed.engines.forEach((item) => {
      if (!item || !item.type || !item.apiKey) return;

      let engine = settings.engines.find((e) => e.type === item.type);
      if (!engine) {
        const preset =
          Transelle.ENGINE_PRESETS[item.type] || Transelle.ENGINE_PRESETS.custom;
        engine = {
          id: item.type,
          type: item.type,
          name: preset.name,
          baseUrl: item.baseUrl || preset.baseUrl,
          model: item.model || preset.model || "",
          apiKey: "",
        };
        settings.engines.push(engine);
      }

      // 非 force 时保留用户自己填过的 Key
      if (!force && engine.apiKey) return;
      if (engine.apiKey === item.apiKey) return;

      engine.apiKey = item.apiKey;
      if (item.model) engine.model = item.model;
      if (item.baseUrl) engine.baseUrl = item.baseUrl;
      applied++;
    });

    // 打上标记：种子只自动生效一次
    settings.seeded = true;
    await Transelle.settings.save(settings);
    return { applied, reason: applied ? "applied" : "nothing-to-do" };
  };

  Transelle.seed = { file: SEED_FILE, read, apply };
})(typeof globalThis !== "undefined" ? globalThis : self);
