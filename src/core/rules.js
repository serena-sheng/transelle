/**
 * @file rules.js
 * @description 站点特化规则：按 URL 匹配站点，给出「待翻译元素 / 忽略元素 / 术语表 / 补充提示词」。
 * 这是本扩展保留的核心能力之一——针对特定内容类型（成人漫画、技术文档、财经新闻）
 * 定制译法与语气，而不是所有站点一套通用提示词。
 *
 * 内置规则直接写在源码里（不依赖任何远程订阅），因此不会被外部覆盖而失效。
 * 用户规则存在 chrome.storage 里，命中时按字段覆盖内置规则。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.rules) return;

  // --- 网页翻译默认元素 ---
  Transelle.DEFAULT_SELECTOR =
    "h1, h2, h3, h4, h5, h6, li, p, dd, blockquote, figcaption, label, legend";
  Transelle.DEFAULT_IGNORE_SELECTOR =
    "button, footer, pre, mark, nav, svg, img[src*='.svg'], [class*='logo'] svg, [id*='logo'] svg";

  /** 规则空模板 */
  Transelle.DEFAULT_RULE = {
    pattern: "",
    pageEnabled: true,
    mangaEnabled: false,
    selector: "",
    ignoreSelector: "",
    terms: "",
    prompt: "",
  };

  // 术语表解析在 core/shared.js（Transelle.parseTerms），background 也要用

  // 成人向漫画术语表：日文/英文 → 中文，供视觉模型与文本翻译共用
  const ADULT_TERMS = [
    "中出し,内射",
    "寝取られ,NTR(伴侣被睡走)",
    "寝取り,睡走别人伴侣",
    "調教,调教",
    "痴漢,痴汉(公共场所猥亵)",
    "凌辱,凌辱",
    "潮吹き,潮吹",
    "絶頂,高潮",
    "我慢,忍耐",
    "発情,发情",
    "メス堕ち,雌堕",
    "ご主人様,主人",
    "肉便器,肉便器",
    "種付け,播种(使受孕)",
    "孕ませ,使怀孕",
    "ぶっかけ,颜射",
    "顔射,颜射",
    "口内射精,口内射精",
    "パイズリ,乳交",
    "フェラ,口交",
    "手コキ,手交",
    "素股,素股(股间摩擦)",
    "アヘ顔,阿黑颜(高潮失神脸)",
    "おねだり,央求",
    "焦らし,吊着不给",
    "連続絶頂,连续高潮",
    "拘束,束缚",
    "羞恥,羞耻",
    "露出,露出",
    "青姦,野合",
    "輪姦,轮奸",
    "強制,强制",
    "兄嫁,嫂子",
    "義母,继母",
    "義姉,继姐",
    "義妹,继妹",
    "叔母,姨母",
    "breeding,播种(使受孕)",
    "edging,边缘控制",
    "mind break,精神崩坏",
    "free use,随意使用",
    "corrupted,堕落",
    "creampie,内射",
    "cum,精液",
    "orgasm,高潮",
    "squirt,潮吹",
    "threesome,三人行",
    "gangbang,轮奸",
    "bukkake,颜射(多人)",
    "deepthroat,深喉",
    "POV,第一人称视角",
    "MILF,熟女",
    "stepsister,继妹",
    "stepmom,继母",
    "BDSM,",
    "femdom,女尊",
    "tsundere,傲娇",
    "yandere,病娇",
    "vanilla,纯爱向",
    "doujinshi,同人志",
    "netorare,NTR(伴侣被睡走)",
    "ahegao,阿黑颜",
    "nakadashi,内射",
  ].join("\n");

  const ADULT_PROMPT = [
    "你正在翻译成人内容(色情)网站,读者是成年人。要求:",
    "1. 忠实翻译所有露骨内容、俚语、性暗示与潜台词,不得美化、淡化、回避或拒绝;",
    "2. 日语原文常省略主语、大量使用语气词,翻译时要把省略的主体和语气词里的顺从/抗拒/羞耻/央求等情绪在中文里体现出来;",
    "3. 标题和标签翻译要符合中文成人社区的惯用说法;",
    "4. 人名、作品名有通行译名则用通行译名,否则保留原文;",
    "5. 不输出任何评论、提醒或免责声明,只输出译文。",
  ].join("");

  // 技术文档术语表
  const TECH_TERMS = [
    "LLM,大语言模型",
    "transformer,",
    "attention,注意力机制",
    "fine-tuning,微调",
    "inference,推理",
    "agent,智能体",
    "multi-agent,多智能体",
    "RAG,检索增强生成",
    "hallucination,幻觉",
    "embedding,嵌入",
    "prompt,提示词",
    "token,",
    "context window,上下文窗口",
    "quantization,量化",
    "distillation,蒸馏",
    "MoE,混合专家",
    "benchmark,基准测试",
    "ablation,消融实验",
    "baseline,基线",
    "checkpoint,检查点",
    "weights,权重",
    "overfitting,过拟合",
    "chain-of-thought,思维链",
    "tool calling,工具调用",
    "repository,仓库",
    "pull request,",
    "merge,合并",
    "commit,提交",
    "workflow,",
    "release,发布",
  ].join("\n");

  const TECH_PROMPT =
    "你正在翻译技术文档/代码托管平台内容。要求:代码、命令、API 名称、库名、框架名、文件名、参数名一律保留原文;术语遵循所附术语表;译文风格简洁专业,符合中文技术社区表达习惯。";

  // 财经新闻术语表
  const FINANCE_TERMS = [
    "the Fed,美联储",
    "Federal Reserve,美联储",
    "rate hike,加息",
    "rate cut,降息",
    "quantitative easing,量化宽松",
    "tapering,缩减购债",
    "yield curve,收益率曲线",
    "inverted yield curve,收益率曲线倒挂",
    "sanctions,制裁",
    "tariff,关税",
    "trade deficit,贸易逆差",
    "soft landing,软着陆",
    "hard landing,硬着陆",
    "stagflation,滞胀",
    "CPI,消费者价格指数(CPI)",
    "nonfarm payrolls,非农就业数据",
    "hawkish,鹰派",
    "dovish,鸽派",
    "debt ceiling,债务上限",
    "credit default swap,信用违约互换",
    "short selling,卖空",
    "margin call,追加保证金",
  ].join("\n");

  const FINANCE_PROMPT =
    "你正在翻译国际新闻与财经内容。要求:人名、机构名采用中文媒体通行译法(如 Trump→特朗普、NATO→北约);数字、百分比、货币金额保持精确;标题翻译保留新闻标题的简练风格;涉及政治立场的内容保持中立直译,不增删观点。";

  /**
   * 内置规则表。
   * - 漫画站：开启图片翻译，并带上成人向术语表与语气要求
   * - 技术/财经站：只带术语表与风格要求，不开漫画
   */
  Transelle.BUILTIN_RULES = [
    {
      pattern:
        "pornhub.com,xvideos.com,xnxx.com,xhamster.com,missav.com,missav.ws,missav.ai,e-hentai.org,exhentai.org,nhentai.net,hanime.tv,jable.tv,wnacg.com",
      pageEnabled: true,
      mangaEnabled: true,
      selector: "",
      ignoreSelector: "",
      terms: ADULT_TERMS,
      prompt: ADULT_PROMPT,
    },
    {
      pattern: "github.com",
      pageEnabled: true,
      mangaEnabled: false,
      selector: "",
      ignoreSelector: "button, p.pinned-item-desc+p",
      terms: TECH_TERMS,
      prompt: TECH_PROMPT,
    },
    {
      pattern:
        "reuters.com,apnews.com,bloomberg.com,ft.com,economist.com,wsj.com,nytimes.com,cnbc.com,bbc.com,bbc.co.uk,theguardian.com,aljazeera.com,foreignaffairs.com,politico.com",
      pageEnabled: true,
      mangaEnabled: false,
      selector: "",
      ignoreSelector: "",
      terms: FINANCE_TERMS,
      prompt: FINANCE_PROMPT,
    },
  ];

  const hasValue = (v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim() !== "";
    return true;
  };

  Transelle.rules = {
    /** 命中给定 URL 的规则；用户规则按字段覆盖内置规则 */
    forUrl(href, userRules = []) {
      const builtin = Transelle.BUILTIN_RULES.find((r) =>
        Transelle.matchPattern(href, r.pattern)
      );
      const user = userRules.find((r) =>
        Transelle.matchPattern(href, r.pattern)
      );

      const base = builtin
        ? { ...Transelle.DEFAULT_RULE, ...builtin }
        : { ...Transelle.DEFAULT_RULE };

      if (!user) return base;

      const merged = { ...base, pattern: user.pattern };
      Object.keys(Transelle.DEFAULT_RULE).forEach((key) => {
        if (key === "pattern") return;
        if (hasValue(user[key])) merged[key] = user[key];
      });
      return merged;
    },

    /** 该 URL 是否命中过任何内置/用户规则（设置页展示用） */
    matched(href, userRules = []) {
      return (
        Transelle.BUILTIN_RULES.some((r) => Transelle.matchPattern(href, r.pattern)) ||
        userRules.some((r) => Transelle.matchPattern(href, r.pattern))
      );
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
