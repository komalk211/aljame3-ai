// ========================================
// Nexara AI — الخادم الوسيط الآمن (نسخة 8 — مكتبة معرفية + بحث ويب ذكي)
// يخفي مفاتيح Claude و Gemini
// -----------------------------------------
// الجديد بهذه النسخة:
//   1) مكتبة معرفية (Cloudflare KV) تُفحص أولاً قبل أي استدعاء API — توفير كامل للتكلفة عند التطابق
//   2) التصنيف يحدد الآن ثلاث قيم: category / complexity / needs_search
//   3) عند needs_search=true يُستدعى Gemini مع تفعيل البحث الفعلي بالويب (Grounding)
//   4) نقطة نهاية جديدة action="rate" لتخزين الإجابات المفيدة تلقائياً بالمكتبة
//   5) نقطة نهاية جديدة action="addLibraryEntry" لإضافة محتوى يدوي (نكت/مقالات) بمفتاح إداري
// -----------------------------------------
// إعداد مطلوب على Cloudflare (مرة واحدة فقط):
//   - أنشئ KV Namespace من: Workers & Pages > KV
//   - اربطه بمشروع Pages من: الإعدادات > Functions > KV namespace bindings
//     باسم المتغيّر: NEXARA_KV
//   - أضف Secret جديد باسم: ADMIN_KEY (كلمة سر من اختيارك لحماية الإضافة اليدوية)
// ملاحظة Cloudflare: يوضع هذا الملف في المسار  functions/api.js
// ========================================

// النماذج
const GEMINI_MAIN = "gemini-2.5-flash";
const CLAUDE_HEAVY = "claude-sonnet-4-5";

// حدود التوكنز
const MAX_TOKENS_SIMPLE = 4000;
const MAX_TOKENS_COMPLEX = 8192;
const MAX_TOKENS_CLAUDE = 8192;

// حد تشابه الكلمات المفتاحية لاعتبار سؤالين "نفس الشيء" (0 إلى 1)
const LIBRARY_MATCH_THRESHOLD = 0.55;
// أقصى عدد سجلات نبحث بينها بالفهرس
const LIBRARY_INDEX_SCAN_LIMIT = 3000;

// ========================================
// قواعد الأسلوب
// ========================================
const STYLE_RULES = `
قواعد إلزامية للإخراج:
- ابدأ مباشرة بالإجابة دون أي مقدمة مثل "بصفتي" أو "كمساعد" أو "بكل سرور" أو "بالطبع".
- لا تستخدم رموز Markdown إطلاقاً: لا # للعناوين، ولا --- للفواصل، ولا ** للتغميق، ولا * أو - في بداية النقاط.
- عند تعداد النقاط اكتبها كجُمل عادية أو مسبوقة بأرقام عربية (١، ٢، ٣)، وللعناوين اكتبها كجملة عادية متبوعة بنقطتين.
- استخدم نصاً عربياً عادياً منظّماً بفقرات واضحة.
- إذا لم تكن متأكداً، قدّم أفضل تحليل ممكن مع توضيح حدود المعرفة، ولا تترك الإجابة فارغة أبداً.
- أكمل إجابتك دائماً حتى نهايتها الطبيعية، ولا تتوقف في منتصف فكرة أو جملة.`;

const DEEP_RULES = `
منهجية الإجابة (طبّقها داخلياً ثم أخرج النتيجة النهائية فقط):
- حلّل السؤال من أكثر من زاوية، وفكّر في الجوانب التي قد تغيب عن إجابة سطحية.
- بعد صياغة إجابتك، راجعها ذاتياً: صحّح أي خطأ، واحذف أي تكرار، وتأكّد من دقّة الأرقام والحقائق.
- ادمج التحليل في إجابة واحدة عميقة ومنظّمة ودقيقة ومكتملة من أولها لآخرها.
- لا تُظهر خطوات تفكيرك أو مراجعتك، أخرج الإجابة النهائية المصقولة فقط.`;

function langInstruction(lang) {
  if (!lang || lang === "auto") {
    return `\n- مهم جداً: اكتب إجابتك بنفس لغة سؤال المستخدم تماماً. إذا سأل بالعربية أجب بالعربية، وإذا سأل بأي لغة أخرى أجب بنفس تلك اللغة.`;
  }
  return `\n- مهم جداً: اكتب إجابتك بالكامل بلغة: ${lang} فقط، بغضّ النظر عن لغة السؤال. يجب أن تكون الإجابة كلها بلغة ${lang}.`;
}

// ========================================
// خيارات أسلوب الإجابة (يختارها المستخدم اختيارياً قبل الإرسال)
// ========================================
const STYLE_OPTION_INSTRUCTIONS = {
  practical: "ركّز إجابتك على الجانب العملي القابل للتطبيق مباشرة، وتجنّب الحشو النظري.",
  concise: "اختصر إجابتك قدر الإمكان مع الحفاظ على المعنى الكامل والدقة.",
  beginner: "اشرح بأسلوب مبسّط يناسب المبتدئين تمامًا، وتجنّب المصطلحات المعقدة غير المشروحة.",
  steps: "قدّم إجابتك على شكل خطوات تنفيذية واضحة ومرقّمة يمكن تطبيقها مباشرة.",
  expert: "أجب بأسلوب خبير متخصص عميق المعرفة بالمجال، بمستوى تفصيل احترافي.",
  risks: "اذكر أهم المخاطر والقيود والاستثناءات المرتبطة بالموضوع ضمن الإجابة."
};
function styleOptionsInstruction(options) {
  if (!Array.isArray(options) || options.length === 0) return "";
  const lines = options
    .filter(o => STYLE_OPTION_INSTRUCTIONS[o])
    .map(o => "- " + STYLE_OPTION_INSTRUCTIONS[o]);
  if (lines.length === 0) return "";
  return "\n" + lines.join("\n");
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, text: "", timedOut: true }), ms)),
  ]);
}

function isRealAnswer(text) {
  return typeof text === "string" && text.trim().length > 15;
}

// ========================================
// الشخصيات (الخبراء)
// ========================================
const EXPERTS = {
  trading: "أنت خبير تداول ومحلل أسواق مالية محترف. حلّل بدقة مع ذكر المخاطر. لا تقدّم نصيحة مالية قاطعة بل معلومات يبني عليها المستخدم قراره." + STYLE_RULES,
  writing: "أنت كاتب وأديب عربي بارع، متمكّن من الأساليب البلاغية والإبداعية والصياغة الراقية. عند كتابة قصة أو نص سردي، اكتبه كاملاً بكل تفاصيله وأحداثه الطبيعية دون اختصار أو تلخيص أو استعجال النهاية، حتى لو كان طويلاً — الطول ليس مشكلة، والأولوية لاكتمال القصة." + STYLE_RULES,
  programming: "أنت مهندس برمجيات خبير. قدّم حلولاً عملية ودقيقة مع شرح واضح وأمثلة كود نظيفة." + STYLE_RULES,
  science: "أنت عالم وباحث متخصص. قدّم معلومات دقيقة مبنية على الأدلة العلمية بلغة واضحة." + STYLE_RULES,
  religion: "أنت باحث متخصص في العلوم الشرعية، دقيق وموضوعي، تذكر الآراء المختلفة باحترام." + STYLE_RULES,
  health: "أنت مختص صحي يقدّم معلومات طبية عامة موثوقة، مع التنبيه دائماً لمراجعة الطبيب المختص." + STYLE_RULES,
  education: "أنت معلّم خبير بارع في التبسيط. اشرح المفاهيم خطوة بخطوة بأسلوب سهل مع أمثلة توضيحية." + STYLE_RULES,
  business: "أنت مستشار أعمال وتسويق محترف. قدّم أفكاراً عملية وخططاً واقعية قابلة للتنفيذ." + STYLE_RULES,
  translation: "أنت مترجم محترف دقيق. ترجم بأمانة مع مراعاة السياق والمعنى والأسلوب الطبيعي في اللغة الهدف." + STYLE_RULES,
  law: "أنت مستشار قانوني يقدّم معلومات قانونية عامة للتوعية، مع التنبيه دائماً لمراجعة محامٍ مختص لكل حالة." + STYLE_RULES,
  psychology: "أنت مختص في علم النفس والتطوير الذاتي، تقدّم إرشاداً عاماً داعماً، مع التنبيه لمراجعة مختص عند الحاجة." + STYLE_RULES,
  daily: "أنت مساعد يومي عملي يجاوب عن الطقس والأخبار والمناسبات والرسائل الصباحية بإيجاز ودقة، معتمداً على أحدث معلومة متاحة لك." + STYLE_RULES,
  general: "أنت مساعد ذكاء اصطناعي خبير وموسوعي. قدّم إجابة شاملة ودقيقة ومنظّمة بالعربية الواضحة." + STYLE_RULES
};

const SENSITIVE = ["health", "religion", "law", "trading"];
const CREATIVE = ["writing"];
const USUALLY_NEEDS_SEARCH = ["daily"];

// ========================================
// تصنيف نوع المحتوى (لتنظيم المكتبة: نكتة/قصة/شعر/حكمة/لغز/علوم/تاريخ/مقال/معلومة عامة)
// ========================================
const CONTENT_TYPE_TESTS = [
  ["joke", /نكتة|نكته|joke/i],
  ["riddle", /لغز|riddle/i],
  ["poem", /شعرا|شعراً|قصيدة|\bpoem\b/i],
  ["quote", /حكمة|اقتباس|\bquote\b|wisdom/i],
  ["science", /حقيقة علمية|scientific fact/i],
  ["historical", /حدث تاريخي|historical event/i],
  ["story", /قصة قصيرة|قصة|short story/i],
  ["article", /اكتب مقال|مقال عن|write an article/i]
];
function classifyContentType(question) {
  const s = question || "";
  for (const [name, re] of CONTENT_TYPE_TESTS) if (re.test(s)) return name;
  return "general_info";
}

// ========================================
// أدوات الكلمات المفتاحية (لمطابقة المكتبة)
// ========================================
const STOPWORDS = new Set([
  "من","إلى","على","في","عن","مع","هل","ما","ماذا","كيف","لماذا","متى","أين","الذي","التي","هذا","هذه","ذلك",
  "و","أو","ثم","بعد","قبل","عند","كل","بعض","لا","لم","لن","إن","أن","كان","كانت","يكون","تكون","هو","هي","انا","أنا","انت","أنت",
  "لي","له","لها","لهم","بها","به","فيه","فيها","اللي","حتى","أيضا","أيضاً","the","a","an","is","are","of","to","in","on","for","and","or"
]);

function extractKeywords(text) {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set(cleaned)];
}

function jaccardSimilarity(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ========================================
// المكتبة المعرفية (Cloudflare KV)
// بنية التخزين:
//   "lib:index"     -> JSON array خفيف: [{id, keywords, category}, ...]
//   "lib:item:<id>" -> JSON كامل: {question, answer, category, keywords, source, rating, date_added}
// ========================================
async function getLibraryIndex(kv) {
  if (!kv) return [];
  try {
    const raw = await kv.get("lib:index");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveLibraryIndex(kv, index) {
  if (!kv) return;
  try {
    await kv.put("lib:index", JSON.stringify(index));
  } catch { /* تجاهل أي خطأ تخزين مؤقت */ }
}

async function searchLibrary(kv, question, category) {
  if (!kv) return null;
  const index = await getLibraryIndex(kv);
  if (index.length === 0) return null;

  const qKeywords = extractKeywords(question);
  if (qKeywords.length === 0) return null;

  let best = null;
  let bestScore = 0;
  const scanList = index.slice(0, LIBRARY_INDEX_SCAN_LIMIT);

  for (const entry of scanList) {
    const score = jaccardSimilarity(qKeywords, entry.keywords || []);
    const boosted = (category && entry.category === category) ? score + 0.05 : score;
    if (boosted > bestScore) {
      bestScore = boosted;
      best = entry;
    }
  }

  if (!best || bestScore < LIBRARY_MATCH_THRESHOLD) return null;

  try {
    const raw = await kv.get("lib:item:" + best.id);
    if (!raw) return null;
    const full = JSON.parse(raw);
    return { ...full, matchScore: bestScore };
  } catch {
    return null;
  }
}

async function addLibraryEntry(kv, { question, answer, category, source }) {
  if (!kv) return { ok: false };
  try {
    const id = crypto.randomUUID();
    const keywords = extractKeywords(question);
    const contentType = classifyContentType(question);
    const entry = {
      question,
      answer,
      category: category || "general",
      contentType,
      keywords,
      source: source || "manual",
      rating: 1,
      date_added: new Date().toISOString(),
    };
    await kv.put("lib:item:" + id, JSON.stringify(entry));

    const index = await getLibraryIndex(kv);
    index.push({ id, keywords, category: entry.category, contentType });
    await saveLibraryIndex(kv, index);

    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ========================================
// "صفحة المجلة" — طلب دفعة عناصر من نوع واحد (نكت/ألغاز/اقتباسات) دفعة وحدة
// ========================================
const BATCH_CONTENT_TYPES = {
  joke: { triggerRegex: /نكتة|نكته|joke/i, pickCount: () => 7, itemsWord: "نكتة", itemsWordPlural: "نكت" },
  riddle: { triggerRegex: /لغز|riddle/i, pickCount: () => (Math.random() < 0.5 ? 6 : 7), itemsWord: "لغز", itemsWordPlural: "ألغاز" },
  quote: { triggerRegex: /حكمة|اقتباس|\bquote\b|wisdom/i, pickCount: () => (Math.random() < 0.5 ? 2 : 3), itemsWord: "حكمة أو اقتباس", itemsWordPlural: "حكم واقتباسات" },
};
function detectBatchType(question) {
  const s = question || "";
  for (const [type, cfg] of Object.entries(BATCH_CONTENT_TYPES)) {
    if (cfg.triggerRegex.test(s)) return type;
  }
  return null;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getLibraryBatchByType(kv, contentType, count) {
  if (!kv) return [];
  const index = await getLibraryIndex(kv);
  const matching = index.filter(e => e.contentType === contentType);
  const picked = shuffleArray(matching).slice(0, count);
  const items = [];
  for (const entry of picked) {
    try {
      const raw = await kv.get("lib:item:" + entry.id);
      if (raw) {
        const full = JSON.parse(raw);
        items.push(full.answer);
      }
    } catch { /* تجاهل عنصر تالف */ }
  }
  return items;
}

const ARABIC_NUMS = ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩", "١٠"];
function formatNumberedList(items) {
  return items.map((t, i) => (ARABIC_NUMS[i] || String(i + 1)) + ". " + t).join("\n\n");
}

async function generateBatchFiller(contentType, count, existingTexts, geminiKey) {
  const cfg = BATCH_CONTENT_TYPES[contentType];
  const avoidList = existingTexts.length
    ? "\nتجنّب تكرار أو مشابهة هذه العناصر الموجودة أصلاً:\n" + existingTexts.map(t => "- " + t.slice(0, 80)).join("\n")
    : "";
  const prompt = `أنت مصدر محتوى عربي خفيف ومتنوع. أعطني بالضبط ${count} عنصر من نوع "${cfg.itemsWordPlural}" جديدة ومختلفة تمامًا عن بعضها.${avoidList}
قواعد الإخراج:
- أرجع النتيجة بصيغة JSON فقط بهذا الشكل: {"items":["العنصر الأول","العنصر الثاني", ...]}
- بالضبط ${count} عنصر داخل المصفوفة، لا أكثر ولا أقل.
- كل عنصر جملة أو جملتين قصيرتين واضحتين، بدون ترقيم داخل النص نفسه.
- لا تكتب أي نص أو شرح خارج الـ JSON.`;

  const result = await withTimeout(
    askGemini(prompt, "أنت مولّد محتوى دقيق تُخرج JSON فقط.", geminiKey, GEMINI_MAIN, 2000, false),
    15000
  );

  try {
    const raw = (result.text || "").replace(/```json|```/g, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (Array.isArray(parsed.items)) {
      return parsed.items.map(s => (typeof s === "string" ? s.trim() : "")).filter(Boolean).slice(0, count);
    }
  } catch { /* فشل التوليد، نرجع مصفوفة فاضية */ }
  return [];
}

// ========================================
// استدعاء Claude
// ========================================
async function askClaude(question, expertPrompt, apiKey, model = CLAUDE_HEAVY, maxTokens = MAX_TOKENS_CLAUDE) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        system: expertPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });
    const data = await res.json();
    if (data.error) return { ok: false, text: "" };
    const text = (data.content || []).map(b => b.text || "").join("");
    return { ok: isRealAnswer(text), text };
  } catch {
    return { ok: false, text: "" };
  }
}

// ========================================
// استدعاء Gemini (مع دعم اختياري للبحث الفعلي بالويب)
// ========================================
async function askGemini(question, expertPrompt, apiKey, model = GEMINI_MAIN, maxTokens = MAX_TOKENS_COMPLEX, useSearch = false) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      system_instruction: { parts: [{ text: expertPrompt }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (useSearch) {
      body.tools = [{ google_search: {} }];
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) {
      return { ok: false, text: "", debug: "GEMINI_ERROR: " + (data.error.message || JSON.stringify(data.error)) };
    }
    const parts = data.candidates?.[0]?.content?.parts;
    let text = "";
    if (Array.isArray(parts)) {
      text = parts.map(p => (p && p.text) ? p.text : "").join("");
    }
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason || "NO_TEXT";
      return { ok: false, text: "", debug: "GEMINI_EMPTY: finishReason=" + reason };
    }
    let sources = [];
    try {
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      sources = chunks.map(c => c.web?.uri).filter(Boolean);
    } catch { /* تجاهل */ }
    return { ok: isRealAnswer(text), text, searchSources: sources };
  } catch (e) {
    return { ok: false, text: "", debug: "GEMINI_EXCEPTION: " + (e.message || String(e)) };
  }
}

// ========================================
// التصنيف الذكي — الآن يحدد أيضاً needs_search
// ========================================
async function classifyQuestion(question, geminiKey) {
  const cats = Object.keys(EXPERTS).join("، ");
  const prompt = `صنّف السؤال التالي وأرجع JSON فقط بهذا الشكل بالضبط:
{"category":"<إحدى الفئات>","complexity":"simple أو complex","needs_search":true أو false}

الفئات المتاحة: ${cats}.
- اختر الفئة الأنسب لموضوع السؤال. فئة "daily" تشمل: الطقس، الأخبار، العطل الرسمية، المناسبات، الرسائل الصباحية.
- "complexity": "simple" لسؤال بسيط ومباشر، "complex" لسؤال يحتاج تحليلاً معمّقاً أو متشعباً أو حسّاساً.
- "needs_search": ضع true إذا كان السؤال يحتاج معلومة لحظية أو حديثة (طقس اليوم، خبر عاجل، سعر حالي، حدث جارٍ، أحدث إصدار، آخر تحديث). ضع false إذا كان السؤال عن معرفة أو مفهوم ثابت لا يتغير بمرور الوقت (شرح، تعريف، مبدأ عام، مهارة).
أجب بالـ JSON فقط دون أي نص إضافي.
السؤال: ${question}`;

  const result = await withTimeout(
    askGemini(prompt, "أنت مصنّف دقيق تُخرج JSON فقط.", geminiKey, GEMINI_MAIN, 250, false),
    6000
  );

  let category = "general";
  let complexity = "simple";
  let needsSearch = false;
  try {
    const raw = (result.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    if (EXPERTS[parsed.category]) category = parsed.category;
    if (parsed.complexity === "simple" || parsed.complexity === "complex") {
      complexity = parsed.complexity;
    }
    if (typeof parsed.needs_search === "boolean") {
      needsSearch = parsed.needs_search;
    }
  } catch {
    // فشل التصنيف: نبقى على القيم الافتراضية
  }
  if (!needsSearch && USUALLY_NEEDS_SEARCH.includes(category)) {
    needsSearch = true;
  }
  return { category, complexity, needsSearch };
}

// ========================================
// المعالج الرئيسي
// ========================================
export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 200, headers });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  const CLAUDE_KEY = env.ANTHROPIC_API_KEY;
  const GEMINI_KEY = env.GEMINI_API_KEY;
  const ADMIN_KEY = env.ADMIN_KEY;
  const KV = env.NEXARA_KV; // يجب ربطه من إعدادات Pages > Functions > KV bindings

  try {
    const body = await request.json();
    const { action, question, lang, styleOptions } = body;

    // ---------- تحسين السؤال ----------
    if (action === "optimize") {
      const langLine = (!lang || lang === "auto")
        ? "اكتب الصياغات الثلاث بنفس لغة السؤال الأصلي تماماً."
        : "اكتب الصياغات الثلاث بلغة: " + lang + " فقط.";
      const prompt = `أنت خبير في صياغة الأسئلة. أعد صياغة السؤال التالي بثلاث طرق محسّنة وأوضح وأكثر احترافية، بحيث تعطي كل صياغة نتيجة أعمق وأدق.
${langLine}
قواعد صارمة للإخراج:
- أخرج النتيجة بصيغة JSON فقط بهذا الشكل بالضبط: {"suggestions":["الصياغة الأولى","الصياغة الثانية","الصياغة الثالثة"]}
- ثلاث صياغات فقط داخل المصفوفة.
- لا تكتب أي مقدمة أو شرح أو نص خارج الـ JSON. الـ JSON فقط.
السؤال: ${question}`;

      const result = await withTimeout(
        askGemini(prompt, "أنت مساعد صياغة دقيق. تُخرج JSON فقط يحتوي على مصفوفة suggestions بثلاث صياغات، دون أي نص إضافي.", GEMINI_KEY, GEMINI_MAIN, 2500, false),
        20000
      );

      let suggestions = [];
      const raw = (result.text || "").trim();
      try {
        const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          const parsed = JSON.parse(cleaned.slice(start, end + 1));
          if (Array.isArray(parsed.suggestions)) {
            suggestions = parsed.suggestions
              .map(s => (typeof s === "string" ? s.trim() : ""))
              .filter(s => s.length > 5)
              .slice(0, 3);
          }
        }
      } catch { /* نتجاهل ونجرّب الطريقة البديلة */ }

      if (suggestions.length === 0 && raw) {
        suggestions = raw
          .split(/\n+/)
          .map(l => l
            .replace(/[{}\[\]"]/g, "")
            .replace(/suggestions\s*:?/gi, "")
            .replace(/^\s*[\d\u0660-\u0669]+[\.\)\-:]\s*/, "")
            .replace(/^["'\s\-\*]+/, "")
            .replace(/[,"']+$/, "")
            .trim()
          )
          .filter(l => l.length > 8)
          .slice(0, 3);
      }

      return new Response(JSON.stringify({ suggestions }), { status: 200, headers });
    }

    // ---------- تقييم إجابة وتخزينها بالمكتبة عند الإيجاب ----------
    if (action === "rate") {
      const { answer, category, positive } = body;
      if (!positive) {
        return new Response(JSON.stringify({ ok: true, stored: false }), { status: 200, headers });
      }
      if (!isRealAnswer(answer) || !question) {
        return new Response(JSON.stringify({ ok: false, error: "بيانات ناقصة" }), { status: 400, headers });
      }
      const result = await addLibraryEntry(KV, {
        question,
        answer,
        category: category || "general",
        source: "user_generated",
      });
      return new Response(JSON.stringify({ ok: result.ok, stored: !!result.ok }), { status: 200, headers });
    }

    // ---------- إضافة يدوية للمكتبة (محمية بمفتاح إداري) ----------
    if (action === "addLibraryEntry") {
      const { adminKey, answer, category } = body;
      if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
        return new Response(JSON.stringify({ error: "غير مصرّح" }), { status: 401, headers });
      }
      if (!question || !isRealAnswer(answer)) {
        return new Response(JSON.stringify({ error: "بيانات ناقصة" }), { status: 400, headers });
      }
      const result = await addLibraryEntry(KV, {
        question,
        answer,
        category: category || "general",
        source: "manual",
      });
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers });
    }

    // ---------- الإجابة الرئيسية ----------
    if (action === "ask") {
      // الخطوة 0: هل السؤال طلب "دفعة" (نكت/ألغاز/اقتباسات) — تُعرض دفعة وحدة مثل صفحة مجلة
      const batchType = detectBatchType(question);
      if (batchType) {
        const cfg = BATCH_CONTENT_TYPES[batchType];
        const targetCount = cfg.pickCount();
        const libraryItems = await getLibraryBatchByType(KV, batchType, targetCount);
        const remaining = targetCount - libraryItems.length;

        let finalItems = libraryItems;
        let usedModel = "library_batch";

        if (remaining > 0) {
          const generated = await generateBatchFiller(batchType, remaining, libraryItems, GEMINI_KEY);
          if (generated.length > 0) {
            // تخزين العناصر المولّدة الجديدة بالمكتبة تلقائياً (تباعاً لتفادي تضارب الفهرس)
            for (const text of generated) {
              await addLibraryEntry(KV, {
                question: text,
                answer: text,
                category: "daily",
                source: "auto_generated_batch",
              });
            }
            finalItems = libraryItems.concat(generated);
            usedModel = libraryItems.length > 0 ? "mixed_batch" : "ai_batch";
          }
        }

        if (finalItems.length === 0) {
          finalItems = ["تعذّر توليد محتوى الآن، حاول مرة أخرى بعد قليل."];
        }

        return new Response(JSON.stringify({
          answer: formatNumberedList(finalItems),
          category: "daily",
          complexity: "simple",
          mode: usedModel,
          batchType,
          batchCount: finalItems.length,
          sources: { claude: false, gemini: usedModel !== "library_batch", library: usedModel !== "ai_batch" },
        }), { status: 200, headers });
      }

      // الخطوة 1: فحص المكتبة أولاً — صفر تكلفة API عند التطابق
      const libraryHit = await searchLibrary(KV, question, null);
      if (libraryHit) {
        return new Response(JSON.stringify({
          answer: libraryHit.answer,
          category: libraryHit.category,
          complexity: "simple",
          mode: "library",
          matchScore: libraryHit.matchScore,
          sources: { claude: false, gemini: false, library: true },
        }), { status: 200, headers });
      }

      // الخطوة 2: التصنيف الذكي (يحدد أيضاً الحاجة لبحث فعلي بالويب)
      const { category, complexity, needsSearch } = await classifyQuestion(question, GEMINI_KEY);

      let expertPrompt = EXPERTS[category] + langInstruction(lang) + styleOptionsInstruction(styleOptions);
      const isComplex = complexity === "complex";
      const isCreative = CREATIVE.includes(category);
      const needClaude = (isComplex && SENSITIVE.includes(category)) || isCreative;

      if (isComplex) {
        expertPrompt += "\n" + DEEP_RULES;
      }

      let finalAnswer = "";
      let usedModel = "gemini";
      let debugInfo = "";
      let searchSources = [];

      if (needsSearch) {
        const searchRes = await withTimeout(
          askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, MAX_TOKENS_COMPLEX, true),
          25000
        );
        if (searchRes.ok) {
          finalAnswer = searchRes.text;
          usedModel = "gemini_search";
          searchSources = searchRes.searchSources || [];
        } else {
          if (searchRes.debug) debugInfo = searchRes.debug;
          const fallbackRes = await withTimeout(
            askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, MAX_TOKENS_COMPLEX, false),
            15000
          );
          finalAnswer = fallbackRes.ok ? fallbackRes.text : "";
          usedModel = "gemini_search_fallback";
        }
      } else if (needClaude) {
        const claudeRes = await withTimeout(
          askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, MAX_TOKENS_CLAUDE),
          25000
        );
        if (claudeRes.ok) {
          finalAnswer = claudeRes.text;
          usedModel = "claude";
        } else {
          const geminiRes = await withTimeout(
            askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, MAX_TOKENS_COMPLEX, false),
            25000
          );
          finalAnswer = geminiRes.ok ? geminiRes.text : "";
          if (geminiRes.debug) debugInfo = geminiRes.debug;
          usedModel = "gemini_fallback";
        }
      } else {
        const geminiRes = await withTimeout(
          askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, isComplex ? MAX_TOKENS_COMPLEX : MAX_TOKENS_SIMPLE, false),
          25000
        );
        if (geminiRes.ok) {
          finalAnswer = geminiRes.text;
          usedModel = "gemini";
        } else {
          if (geminiRes.debug) debugInfo = geminiRes.debug;
          const claudeRes = await withTimeout(
            askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, MAX_TOKENS_CLAUDE),
            20000
          );
          finalAnswer = claudeRes.ok ? claudeRes.text : "";
          usedModel = "claude_fallback";
        }
      }

      if (!isRealAnswer(finalAnswer)) {
        finalAnswer = "تعذّر توليد إجابة كافية لهذا السؤال الآن. حاول تبسيط صياغته أو أعد المحاولة بعد قليل."
          + (debugInfo ? ("\n\n[تشخيص مؤقت: " + debugInfo + "]") : "");
      }

      // تخزين تلقائي بالمكتبة — فقط للأبواب العادية غير الحساسة وغير المعتمدة على بحث لحظي
      // (الفئات الحساسة SENSITIVE تبقى تحتاج تقييم يدوي 👍 عبر action=rate كطبقة حماية إضافية)
      const autoStoreEligible = isRealAnswer(finalAnswer) && !needsSearch && !SENSITIVE.includes(category);
      if (autoStoreEligible) {
        await addLibraryEntry(KV, {
          question,
          answer: finalAnswer,
          category,
          source: "auto_generated",
        });
      }

      return new Response(JSON.stringify({
        answer: finalAnswer,
        category,
        complexity,
        mode: usedModel,
        usedSearch: needsSearch,
        searchSources,
        sources: {
          claude: usedModel.startsWith("claude"),
          gemini: usedModel.startsWith("gemini"),
          library: false,
        },
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
