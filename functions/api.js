// ========================================
// Nexara AI — الخادم الوسيط الآمن (نسخة 6 — متوافقة مع Cloudflare Pages)
// يخفي مفاتيح Claude و Gemini
// الاستراتيجية:
//   • Gemini Flash هو النموذج الأساسي (رخيص + يتحمّل مئات وآلاف المستخدمين)
//   • Claude يُستدعى فقط للأسئلة المعقّدة جداً أو الحسّاسة (الضرورة القصوى)
//   • استدعاءان فقط لكل سؤال: تصنيف + إجابة
//   • التحسين (optimize) على Gemini للتوفير
// دعم اختيار لغة الإجابة (تلقائي أو لغة محددة)
// إصلاحات محفوظة: منع المقدمات + منع Markdown + عدم ترك الإجابة فارغة أبداً
// -----------------------------------------
// ملاحظة Cloudflare: يوضع هذا الملف في المسار  functions/api.js
// ويُستدعى تلقائياً من الواجهة عبر  /api
// المفاتيح تُقرأ من env (وليس process.env)
// ========================================

// النماذج
const GEMINI_MAIN = "gemini-2.5-flash";                 // الأساسي لكل شيء تقريباً
const CLAUDE_HEAVY = "claude-haiku-4-5-20251001";       // يُستدعى للضرورة القصوى فقط

// ========================================
// قواعد الأسلوب — تُضاف لكل خبير
// ========================================
const STYLE_RULES = `
قواعد إلزامية للإخراج:
- ابدأ مباشرة بالإجابة دون أي مقدمة مثل "بصفتي" أو "كمساعد" أو "بكل سرور" أو "بالطبع".
- لا تستخدم رموز Markdown إطلاقاً: لا # للعناوين، ولا --- للفواصل، ولا ** للتغميق، ولا * أو - في بداية النقاط.
- عند تعداد النقاط اكتبها كجُمل عادية أو مسبوقة بأرقام عربية (١، ٢، ٣)، وللعناوين اكتبها كجملة عادية متبوعة بنقطتين.
- استخدم نصاً عربياً عادياً منظّماً بفقرات واضحة.
- إذا لم تكن متأكداً، قدّم أفضل تحليل ممكن مع توضيح حدود المعرفة، ولا تترك الإجابة فارغة أبداً.
- اجعل إجابتك وافية لكن مركّزة، دون إطالة غير ضرورية.`;

// ========================================
// برومبت المعالجة العميقة — للأسئلة المعقّدة (تحليل + تدقيق داخلي في استدعاء واحد)
// ========================================
const DEEP_RULES = `
منهجية الإجابة (طبّقها داخلياً ثم أخرج النتيجة النهائية فقط):
- حلّل السؤال من أكثر من زاوية، وفكّر في الجوانب التي قد تغيب عن إجابة سطحية.
- بعد صياغة إجابتك، راجعها ذاتياً: صحّح أي خطأ، واحذف أي تكرار، وتأكّد من دقّة الأرقام والحقائق.
- ادمج التحليل في إجابة واحدة عميقة ومنظّمة ودقيقة.
- لا تُظهر خطوات تفكيرك أو مراجعتك، أخرج الإجابة النهائية المصقولة فقط.`;

// تعليمة اللغة: تُبنى حسب اختيار المستخدم
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
// الشخصيات (الخبراء) — موسّعة
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

// الفئات التي تُعدّ حسّاسة (يُفضّل استدعاء Claude لها عندما تكون معقّدة)
const SENSITIVE = ["health", "religion", "law", "trading"];

// ========================================
// استدعاء Claude
// ========================================
async function askClaude(question, expertPrompt, apiKey, model = CLAUDE_HEAVY, maxTokens = 2000) {
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
// استدعاء Gemini
// ========================================
async function askGemini(question, expertPrompt, apiKey, model = GEMINI_MAIN, maxTokens = 2000) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: expertPrompt }] },
        contents: [{ parts: [{ text: question }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts;
    let text = "";
    if (Array.isArray(parts)) {
      text = parts.map(p => (p && p.text) ? p.text : "").join("");
    }
    return { ok: isRealAnswer(text), text };
  } catch {
    return { ok: false, text: "" };
  }
}

// ========================================
// التصنيف الذكي — استدعاء واحد بـ Gemini يحدّد:
//   المجال + مستوى التعقيد (simple / complex)
// يُرجِع: { category, complexity }
// ========================================
async function classifyQuestion(question, geminiKey) {
  const cats = Object.keys(EXPERTS).join("، ");
  const prompt = `صنّف السؤال التالي وأرجع JSON فقط بهذا الشكل بالضبط:
{"category":"<إحدى الفئات>","complexity":"simple أو complex"}

الفئات المتاحة: ${cats}.
- اختر الفئة الأنسب لموضوع السؤال.
- "complexity": ضع "simple" إذا كان السؤال بسيطاً ومباشراً (تعريف، معلومة سريعة، سؤال قصير).
  وضع "complex" إذا كان يحتاج تحليلاً أو شرحاً معمّقاً أو موضوعاً متشعّباً أو حسّاساً.
أجب بالـ JSON فقط دون أي نص إضافي.
السؤال: ${question}`;

  const result = await withTimeout(
    askGemini(prompt, "أنت مصنّف دقيق تُخرج JSON فقط.", geminiKey, GEMINI_MAIN, 200),
    6000
  );

  let category = "general";
  let complexity = "simple"; // الافتراض الأوفر: عامله كبسيط ما لم يُصنّف معقّداً صراحةً
  try {
    const raw = (result.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    if (EXPERTS[parsed.category]) category = parsed.category;
    if (parsed.complexity === "simple" || parsed.complexity === "complex") {
      complexity = parsed.complexity;
    }
  } catch {
    // في حال فشل التصنيف: نبقى على general + simple (الأوفر، Gemini يكفي)
  }
  return { category, complexity };
}

// ========================================
// المعالج الرئيسي — صيغة Cloudflare Pages Functions
// (يستقبل context الذي يحوي request و env)
// ========================================
export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // طلب الفحص المبدئي (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response("", { status: 200, headers });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  // المفاتيح من متغيّرات البيئة في Cloudflare
  const CLAUDE_KEY = env.ANTHROPIC_API_KEY;
  const GEMINI_KEY = env.GEMINI_API_KEY;

  try {
    const { action, question, lang } = await request.json();

    // ---------- تحسين السؤال (على Gemini للتوفير) ----------
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

      // المحاولة الأولى: قراءة JSON (الأوثق)
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

      // المحاولة البديلة: التقسيم على الأسطر (لو فشل JSON)
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
      // 1) التصنيف الذكي (استدعاء واحد بـ Gemini): المجال + التعقيد
      const { category, complexity } = await classifyQuestion(question, GEMINI_KEY);

      // نبني تعليمة الخبير + اللغة
      let expertPrompt = EXPERTS[category] + langInstruction(lang);

      // هل نحتاج المعالجة العميقة؟ (معقّد)
      const isComplex = complexity === "complex";
      // هل نستدعي Claude (الضرورة القصوى)؟ = معقّد + فئة حسّاسة
      const needClaude = isComplex && SENSITIVE.includes(category);

      // للأسئلة المعقّدة نضيف منهجية التحليل والتدقيق الداخلي
      if (isComplex) {
        expertPrompt += "\n" + DEEP_RULES;
      }

      // 2) الإجابة (استدعاء واحد)
      let finalAnswer = "";
      let usedModel = "gemini";

      if (needClaude) {
        // الضرورة القصوى: Claude
        const claudeRes = await withTimeout(
          askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, 2200),
          12000
        );
        if (claudeRes.ok) {
          finalAnswer = claudeRes.text;
          usedModel = "claude";
        } else {
          // فشل كلود → نرجع لجيميني كخطة بديلة
          const geminiRes = await withTimeout(
            askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, 2200),
            12000
          );
          finalAnswer = geminiRes.ok ? geminiRes.text : "";
          usedModel = "gemini_fallback";
        }
      } else {
        // الأغلب: Gemini وحده (بسيط أو معقّد غير حسّاس)
        const geminiRes = await withTimeout(
          askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, isComplex ? 2200 : 1400),
          12000
        );
        if (geminiRes.ok) {
          finalAnswer = geminiRes.text;
          usedModel = "gemini";
        } else {
          // فشل جيميني → محاولة أخيرة بكلود لضمان عدم الفشل
          const claudeRes = await withTimeout(
            askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_HEAVY, 1800),
            10000
          );
          finalAnswer = claudeRes.ok ? claudeRes.text : "";
          usedModel = "claude_fallback";
        }
      }

      // ضمان عدم ترك الإجابة فارغة أبداً
      if (!isRealAnswer(finalAnswer)) {
        finalAnswer = "تعذّر توليد إجابة كافية لهذا السؤال الآن. حاول تبسيط صياغته أو أعد المحاولة بعد قليل.";
      }

      return new Response(JSON.stringify({
        answer: finalAnswer,
        category,
        complexity,
        mode: usedModel,
        sources: {
          claude: usedModel.startsWith("claude"),
          gemini: usedModel.startsWith("gemini"),
        },
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
