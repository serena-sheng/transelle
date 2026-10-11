/**
 * @file romaji.js
 * @description 假名 → 罗马音（Hepburn 简化版）。纯本地换算，不花 token、不联网。
 *
 * 用途：译文里若仍残留假名（难译的片假名、或是日语里毫无意义的假名拼合），
 * 与其留一串看不懂的字，不如按配置转成罗马音呈现。
 * 只碰假名，汉字 / 拉丁字母 / 标点一律原样保留。
 */
(function (root) {
  const Transelle = (root.Transelle = root.Transelle || {});
  if (Transelle.toRomaji) return;

  // 拗音 / 外来语音节（先匹配两字符）
  const DIGRAPHS = {
    "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo", "きぇ": "kye",
    "しゃ": "sha", "しゅ": "shu", "しょ": "sho", "しぇ": "she",
    "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho", "ちぇ": "che",
    "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo", "にぇ": "nye",
    "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo", "ひぇ": "hye",
    "みゃ": "mya", "みゅ": "myu", "みょ": "myo", "みぇ": "mye",
    "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo", "りぇ": "rye",
    "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo", "ぎぇ": "gye",
    "じゃ": "ja", "じゅ": "ju", "じょ": "jo", "じぇ": "je",
    "びゃ": "bya", "びゅ": "byu", "びょ": "byo", "びぇ": "bye",
    "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo", "ぴぇ": "pye",
    "ふぁ": "fa", "ふぃ": "fi", "ふぇ": "fe", "ふぉ": "fo",
    "うぁ": "wa", "うぃ": "wi", "うぇ": "we", "うぉ": "wo",
    "ゔぁ": "va", "ゔぃ": "vi", "ゔぇ": "ve", "ゔぉ": "vo",
    "てぃ": "ti", "てゅ": "tyu", "でぃ": "di", "でゅ": "dyu",
    "とぅ": "tu", "どぅ": "du",
    "つぁ": "tsa", "つぃ": "tsi", "つぇ": "tse", "つぉ": "tso",
  };

  const MONO = {
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
    "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
    "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
    "わ": "wa", "ゐ": "i", "ゑ": "e", "を": "o", "ん": "n",
    "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o",
    "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa",
    "ゔ": "vu",
  };

  const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/;
  const HIRA_START = 0x30a1;
  const HIRA_END = 0x30f6;

  /** 片假名 → 平假名（同一码位偏移 0x60） */
  const toHira = (ch) => {
    if (!ch) return ch;
    const c = ch.charCodeAt(0);
    return c >= HIRA_START && c <= HIRA_END ? String.fromCharCode(c - 0x60) : ch;
  };

  /**
   * 把字符串里的假名换成罗马音；非假名字符原样保留。
   * @param {string} input
   * @returns {string}
   */
  Transelle.toRomaji = (input) => {
    const s = String(input || "");
    let out = "";
    let lastVowel = "";
    let sokuon = false; // 上一个是「っ」
    let i = 0;

    while (i < s.length) {
      const a = toHira(s[i]);

      // 促音：双写后一个音的首字母
      if (a === "っ") {
        sokuon = true;
        i++;
        continue;
      }
      // 长音符：补上一个元音
      if (a === "ー") {
        out += lastVowel;
        i++;
        continue;
      }

      const b = toHira(s[i + 1] || "");
      let romaji = DIGRAPHS[a + b];
      let step = 2;
      if (romaji === undefined) {
        romaji = MONO[a];
        step = 1;
      }

      if (romaji === undefined) {
        // 非假名（汉字、拉丁、标点…）：原样输出
        out += s[i];
        i += 1;
        sokuon = false;
        lastVowel = "";
        continue;
      }

      if (sokuon) {
        // っち → tchi（Hepburn），其余双写首字母
        romaji = (romaji.startsWith("ch") ? "t" : romaji[0]) + romaji;
        sokuon = false;
      }
      out += romaji;
      i += step;
      const vowels = romaji.match(/[aeiou]/g);
      lastVowel = vowels ? vowels[vowels.length - 1] : "";
    }
    return out;
  };

  /** 是否含假名（与 shared.js 的 hasKana 一致，这里也留一份便于本文件自洽） */
  Transelle.hasKana = Transelle.hasKana || ((t) => KANA_RE.test(String(t || "")));
})(typeof globalThis !== "undefined" ? globalThis : self);
