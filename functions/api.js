// ========================================
// Nexara AI — الخادم الوسيط الآمن (نسخة 9 — Cloudflare Pages)
// يخفي مفاتيح Claude و Gemini
// الجديد في نسخة 9:
//   • حقن التاريخ والوقت الحالي في كل طلب (يحل مشكلة تواريخ 2024 القديمة)
//   • تفعيل البحث الحيّ عبر Google Search grounding في Gemini
//   • كشف تلقائي للأسئلة التي تحتاج بحثاً (كلمات مفتاحية + حقل needs_search من المصنّف)
//   • الأسئلة المتغيّرة (طقس/عطل/أخبار/أسعار) تُوجَّه لـ Gemini-with-search أولاً
// -----------------------------------------
// المسار: functions/api.js — يُستدعى عبر /api
// المفاتيح تُقرأ من env
// ========================================

// النماذج
const GEMINI_MAIN = "gemini-2.5-flash";
const CLAUDE_HEAVY = "claude-sonnet-4-5";

// حدود التوكنز
const MAX_TOKENS_SIMPLE = 4000;
const MAX_TOKENS_COMPLEX = 8192;
const MAX_TOKENS_CLAUDE = 8192;

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

// ========================================
// سياق التاريخ — يُبنى من تاريخ الجهاز (client) مع fallback على السيرفر
// هذا هو أهم إصلاح لمشكلة تواريخ 2024
// ========================================
function buildDateContext(clientLocal, clientTz) {
  let dateStr = (typeof clientLocal === "string" && clientLocal.trim()) ? clientLocal.trim() : "";
  let tz = (typeof clientTz === "string" && clientTz.trim()) ? clientTz.trim() : "";

  if (!dateStr) {
    // fallback: توقيت السيرفر (نستعمل الأردن كافتراضي معقول)
    try {
      dateStr = new Date().toLocaleString("ar-EG", {
        dateStyle: "full", timeStyle: "short", timeZone: "Asia/Amman"
      });
      if (!tz) tz = "Asia/Amman";
    } catch {
      dateStr = new Date().toISOString();
    }
  }

  return `معلومة زمنية مهمة جداً — اعتمدها دائماً كمرجع:
التاريخ والوقت الحاليّان هما: ${dateStr}${tz ? " (المنطقة الزمنية: " + tz + ")" : ""}.
لا تفترض أبداً أن السنة هي 2023 أو 2024. أي إشارة إلى "اليوم" أو "هذا العام" أو "القريب" أو "القادم" يجب أن تُحسب انطلاقاً من هذا التاريخ.
إذا كان السؤال عن معلومة قابلة للتغيّر (طقس، عطلة رسمية، عيد، أخبار، أسعار، مواعيد، نتائج) فاعتمد على نتائج البحث إن كانت متاحة، ولا تعطِ أبداً تواريخ أو أرقاماً قديمة من ذاكرتك.`;
}

// ========================================
// كشف الأسئلة التي تحتاج بحثاً حيّاً
// ========================================
function detectNeedsSearch(q) {
  if (!q || typeof q !== "string") return false;
  const t = q.toLowerCase();
  const patterns = [
    // زمن حالي
    "اليوم","الآن","الان","حاليا","حالياً","الحين","هاليومين","هالأيام","هالايام","هذه اللحظة",
    // طقس
    "طقس","الطقس","حرارة","الحرارة","درجة الحرارة","أمطار","امطار","رياح","مطر","الجو","مناخ",
    // عطل ومناسبات
    "عطلة","عطل","العطل","إجازة","اجازة","عيد","العيد","أعياد","اعياد","مناسبة","المولد","رأس السنة","راس السنة","رمضان",
    // أخبار
    "أخبار","اخبار","خبر","آخر","اخر","أحدث","احدث","جديد","مستجدات","حصل","صار",
    // أسعار
    "سعر","أسعار","اسعار","تكلفة","كم يكلف","كم سعر","بكم","صرف الدولار","سعر الصرف",
    // مواعيد
    "متى","موعد","مواعيد","هذا الأسبوع","هذا الاسبوع","هذا الشهر","هذه السنة","هذا العام","القادم","القادمة","المقبل","القريب",
    // رياضة
    "مباراة","نتيجة","من فاز","الدوري","تشكيلة","سجّل",
    // سنوات
    "2024","2025","2026","2027","٢٠٢٤","٢٠٢٥","٢٠٢٦",
    // English
    "weather","temperature","forecast","rain","wind","today","tonight","now","current","currently",
    "latest","news","recent","this week","this month","this year","upcoming","holiday","holidays",
    "price","cost","how much","exchange rate","when is","when does","score","who won","standings"
  ];
  return patterns.some(p => t.includes(p));
}

function langInstruction(lang) {
  if (!lang || lang === "auto") {
    return `\n- مهم جداً: اكتب إجابتك بنفس لغة سؤال المستخدم تماماً. إذا سأل بالعربية أجب بالعربية، وإذا سأل بأي لغة أخرى أجب بنفس تلك اللغة.`;
  }
  return `\n- مهم جداً: اكتب إجابتك بالكامل بلغة: ${lang} فقط، بغضّ النظر عن لغة السؤال. يجب أن تكون الإجابة كلها بلغة ${lang}.`;
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
// الخبراء
// ========================================
const EXPERTS = {
  trading: "أنت خبير تداول ومحلل أسواق مالية محترف. حلّل بدقة مع ذكر المخاطر. لا تقدّم نصيحة مالية قاطعة بل معلومات يبني عليها المستخدم قراره." + STYLE_RULES,
  writing: "أنت كاتب وأديب عربي بارع، متمكّن من الأساليب البلاغية والإبداعية والصياغة الراقية." + STYLE_RULES,
  programming: "أنت مهندس برمجيات خبير. قدّم حلولاً عملية ودقيقة مع شرح واضح وأمثلة كود نظيفة." + STYLE_RULES,
  science: "أنت عالم وباحث متخصص. قدّم معلومات دقيقة مبنية على الأدلة العلمية بلغة واضحة." + STYLE_RULES,
  religion: "أنت باحث متخصص في العلوم الشرعية، دقيق وموضوعي، تذكر الآراء المختلفة باحترام." + STYLE_RULES,
  health: "أنت مختص صحي يقدّم معلومات طبية عامة موثوقة، مع التنبيه دائماً لمراجعة الطبيب المختص." + STYLE_RULES,
  education: "أنت معلّم خبير بارع في التبسيط. اشرح المفاهيم خطوة بخطوة بأسلوب سهل مع أمثلة توضيحية." + STYLE_RULES,
  business: "أنت مستشار أعمال وتسويق محترف. قدّم أفكاراً عملية وخططاً واقعية قابلة للتنفيذ." + STYLE_RULES,
  translation: "أنت مترجم محترف دقيق. ترجم بأمانة مع مراعاة السياق والمعنى والأسلوب الطبيعي في اللغة الهدف." + STYLE_RULES,
  law: "أنت مستشار قانوني يقدّم معلومات قانونية عامة للتوعية، مع التنبيه دائماً لمراجعة محامٍ مختص لكل حالة." + STYLE_RULES,
  psychology: "أنت مختص في علم النفس والتطوير الذاتي، تقدّم إرشاداً عاماً داعماً، مع التنبيه لمراجعة مختص عند الحاجة." + STYLE_RULES,
  general: "أنت مساعد ذكاء اصطناعي خبير وموسوعي. قدّم إجابة شاملة ودقيقة ومنظّمة بالعربية الواضحة." + STYLE_RULES
};

const SENSITIVE = ["health", "religion", "law", "trading"];
const CREATIVE = ["writing"];

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
// استدعاء Gemini — مع دعم البحث (useSearch)
// ========================================
async function askGemini(question, expertPrompt, apiKey, model = GEMINI_MAIN, maxTokens = MAX_TOKENS_COMPLEX, useSearch = false) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      system_instruction: { parts: [{ text: expertPrompt }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    // تفعيل البحث الحيّ عبر Google Search grounding
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

    // استخراج مصادر البحث (اختياري)
    let searchSources = [];
    try {
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      searchSources = chunks
        .map(c => c?.web?.uri || c?.web?.title || "")
        .filter(Boolean)
        .slice(0, 5);
    } catch { /* تجاهل */ }

    return { ok: isRealAnswer(text), text, searchSources };
  } catch (e) {
    return { ok: false, text: "", debug: "GEMINI_EXCEPTION: " + (e.message || String(e)) };
  }
}

// ========================================
// التصنيف الذكي — يُرجِع: { category, complexity, needsSearch }
// ========================================
async function classifyQuestion(question, geminiKey) {
  const cats = Object.keys(EXPERTS).join("، ");
  const prompt = `صنّف السؤال التالي وأرجع JSON فقط بهذا الشكل بالضبط:
{"category":"<إحدى الفئات>","complexity":"simple أو complex","needs_search":true أو false}

الفئات المتاحة: ${cats}.
- "category": اختر الفئة الأنسب لموضوع السؤال.
- "complexity": ضع "simple" للأسئلة البسيطة المباشرة، و"complex" لما يحتاج تحليلاً أو شرحاً معمّقاً أو موضوعاً حسّاساً.
- "needs_search": ضع true إذا كان السؤال يحتاج معلومة حديثة أو متغيّرة (طقس، أخبار، عطل رسمية، أسعار، مواعيد، نتائج، أي شيء يتعلق بـ"اليوم" أو "الآن" أو "الأحدث")، وإلا ضع false.
أجب بالـ JSON فقط دون أي نص إضافي.
السؤال: ${question}`;

  const result = await withTimeout(
    askGemini(prompt, "أنت مصنّف دقيق تُخرج JSON فقط.", geminiKey, GEMINI_MAIN, 200),
    6000
  );

  let category = "general";
  let complexity = "simple";
  let needsSearch = false;
  try {
    const raw = (result.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    if (EXPERTS[parsed.category]) category = parsed.category;
    if (parsed.complexity === "simple" || parsed.complexity === "complex") complexity = parsed.complexity;
    if (parsed.needs_search === true || parsed.needs_search === "true") needsSearch = true;
  } catch {
    // نبقى على القيم الافتراضية
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

  try {
    const { action, question, lang, client_date_local, client_tz } = await request.json();

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
        askGemini(prompt, "أنت مساعد صياغة دقيق. تُخرج JSON فقط يحتوي على مصفوفة suggestions بثلاث صياغات، دون أي نص إضافي.", GEMINI_KEY, GEMINI_MAIN, 2500),
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
      } catch { /* الطريقة البديلة */ }

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

    // ---------- الإجابة ----------
    if (action === "ask") {
      const { category, complexity, needsSearch: classifierSearch } =
        await classifyQuestion(question, GEMINI_KEY);

      // البحث يتفعّل لو الكلمات المفتاحية أو المصنّف طلبه
      const needsSearch = detectNeedsSearch(question) || classifierSearch;

      // سياق التاريخ يُحقن في كل إجابة
      const dateContext = buildDateContext(client_date_local, client_tz);

      let expertPrompt = dateContext + "\n\n" + EXPERTS[category] + langInstruction(lang);

      const isComplex = complexity === "complex";
      const isCreative = CREATIVE.includes(category);

      if (isComplex) {
        expertPrompt += "\n" + DEEP_RULES;
      }

      let finalAnswer = "";
      let usedModel = "gemini";
      let usedSearch = false;
      let searchSources = [];
      let debugInfo = "";

      if (needsSearch) {
        // ===== سؤال يحتاج بحثاً: Gemini مع Google Search أولاً =====
        // (Claude هنا لا يملك أداة بحث، لذلك نبدأ بـ Gemini)
        const geminiRes = await withTimeout(
          askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, MAX_TOKENS_COMPLEX, true),
          28000
        );
        if (geminiRes.ok) {
          finalAnswer = geminiRes.text;
          usedModel = "gemini";
          usedSearch = true;
          searchSources = geminiRes.searchSources || [];
        } else {
          if (geminiRes.debug) debugInfo = geminiRes.debug;
          // fallback: Claude (بدون بحث) — أفضل من لا شيء
          const claudeRes = await withTimeout(
            askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, MAX_TOKENS_CLAUDE),
            22000
          );
          finalAnswer = claudeRes.ok ? claudeRes.text : "";
          usedModel = "claude_fallback";
        }
      } else {
        // ===== المسار العادي =====
        const needClaude = (isComplex && SENSITIVE.includes(category)) || isCreative;

        if (needClaude) {
          const claudeRes = await withTimeout(
            askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, MAX_TOKENS_CLAUDE),
            25000
          );
          if (claudeRes.ok) {
            finalAnswer = claudeRes.text;
            usedModel = "claude";
          } else {
            const geminiRes = await withTimeout(
              askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, MAX_TOKENS_COMPLEX),
              25000
            );
            finalAnswer = geminiRes.ok ? geminiRes.text : "";
            if (geminiRes.debug) debugInfo = geminiRes.debug;
            usedModel = "gemini_fallback";
          }
        } else {
          const geminiRes = await withTimeout(
            askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, isComplex ? MAX_TOKENS_COMPLEX : MAX_TOKENS_SIMPLE),
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
      }

      if (!isRealAnswer(finalAnswer)) {
        finalAnswer = "تعذّر توليد إجابة كافية لهذا السؤال الآن. حاول تبسيط صياغته أو أعد المحاولة بعد قليل."
          + (debugInfo ? ("\n\n[تشخيص مؤقت: " + debugInfo + "]") : "");
      }

      return new Response(JSON.stringify({
        answer: finalAnswer,
        category,
        complexity,
        mode: usedModel,
        needs_search: needsSearch,
        used_search: usedSearch,
        search_sources: searchSources,
        sources: {
          claude: usedModel.startsWith("claude"),
          gemini: usedModel.startsWith("gemini"),
          search: usedSearch,
        },
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
