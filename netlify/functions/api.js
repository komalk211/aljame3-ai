// ========================================
// Nexara AI — الخادم الوسيط الآمن (نسخة 5 — دعم اللغات)
// يخفي مفاتيح Claude و Gemini
// يدير: التصنيف + النموذجين السريعين + الدمج
// الحل: استخدام نماذج سريعة (haiku + flash) لتفادي تجاوز الوقت نهائياً
// جديد: دعم اختيار لغة الإجابة (تلقائي أو لغة محددة)
// إصلاحات محفوظة: قطع الإجابة + إزالة المقدمات + منع Markdown + الردود الفارغة + ضمان عدم الفشل
// ========================================

// النماذج — كلها سريعة الآن لتفادي الـ timeout
const CLAUDE_FAST = "claude-haiku-4-5-20251001";
const CLAUDE_MAIN = "claude-haiku-4-5-20251001"; // بدّلنا sonnet بـ haiku للسرعة
const GEMINI_MAIN = "gemini-2.5-flash";

// تعليمة عامة تُضاف لكل خبير: تمنع المقدمات وتمنع Markdown
const STYLE_RULES = `
قواعد إلزامية للإخراج:
- ابدأ مباشرة بالإجابة دون أي مقدمة مثل "بصفتي" أو "كمساعد" أو "بكل سرور" أو "بالطبع".
- لا تستخدم رموز Markdown إطلاقاً: لا # للعناوين، ولا --- للفواصل، ولا ** للتغميق، ولا * أو - في بداية النقاط.
- عند تعداد النقاط اكتبها كجُمل عادية أو مسبوقة بأرقام عربية (١، ٢، ٣)، وللعناوين اكتبها كجملة عادية متبوعة بنقطتين.
- استخدم نصاً عربياً عادياً منظّماً بفقرات واضحة.
- إذا لم تكن متأكداً، قدّم أفضل تحليل ممكن مع توضيح حدود المعرفة، ولا تترك الإجابة فارغة أبداً.
- اجعل إجابتك وافية لكن مركّزة، دون إطالة غير ضرورية.`;

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

const EXPERTS = {
  trading: "أنت خبير تداول ومحلل أسواق مالية محترف. حلّل بدقة مع ذكر المخاطر. لا تقدّم نصيحة مالية قاطعة بل معلومات يبني عليها المستخدم قراره." + STYLE_RULES,
  writing: "أنت كاتب وأديب عربي بارع، متمكّن من الأساليب البلاغية والإبداعية والصياغة الراقية." + STYLE_RULES,
  programming: "أنت مهندس برمجيات خبير. قدّم حلولاً عملية ودقيقة مع شرح واضح وأمثلة كود نظيفة." + STYLE_RULES,
  science: "أنت عالم وباحث متخصص. قدّم معلومات دقيقة مبنية على الأدلة العلمية بلغة واضحة." + STYLE_RULES,
  religion: "أنت باحث متخصص في العلوم الشرعية، دقيق وموضوعي، تذكر الآراء المختلفة باحترام." + STYLE_RULES,
  health: "أنت مختص صحي يقدّم معلومات طبية عامة موثوقة، مع التنبيه دائماً لمراجعة الطبيب المختص." + STYLE_RULES,
  general: "أنت مساعد ذكاء اصطناعي خبير وموسوعي. قدّم إجابة شاملة ودقيقة ومنظّمة بالعربية الواضحة." + STYLE_RULES
};

async function askClaude(question, expertPrompt, apiKey, model = CLAUDE_MAIN, maxTokens = 2000) {
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
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { ok: isRealAnswer(text), text };
  } catch {
    return { ok: false, text: "" };
  }
}

async function classifyQuestion(question, apiKey) {
  const prompt = `صنّف السؤال التالي إلى واحدة فقط من هذه الفئات:
trading، writing، programming، science، religion، health، general.
أجب بكلمة واحدة فقط.
السؤال: ${question}`;
  const result = await withTimeout(
    askClaude(prompt, "أنت مصنّف دقيق.", apiKey, CLAUDE_FAST, 20),
    3500
  );
  if (!result.ok) return "general";
  const category = (result.text || "general").trim().toLowerCase();
  return EXPERTS[category] ? category : "general";
}

// دمج الإجابتين بنموذج سريع
async function mergeAnswers(question, claudeText, geminiText, claudeKey, lang) {
  const prompt = `لديك إجابتان من خبيرين على نفس السؤال. ألّف إجابة نهائية واحدة متميزة:
- ادمج أفضل ما فيهما، احذف التكرار، صحّح أي تضارب.
- نظّم الإجابة: مقدمة موجزة، ثم تفصيل، ثم خلاصة.
- لا تبدأ بأي مقدمة عن نفسك. لا تستخدم رموز Markdown إطلاقاً (لا # ولا --- ولا ** ولا * في بداية السطر).${langInstruction(lang)}
السؤال: ${question}
الخبير الأول:
${claudeText}
الخبير الثاني:
${geminiText}
أخرج الإجابة النهائية فقط:`;

  const result = await withTimeout(
    askClaude(prompt, "أنت محرّر بحثي خبير." + STYLE_RULES, claudeKey, CLAUDE_MAIN, 2200),
    9000
  );
  if (!result.ok) {
    const c = isRealAnswer(claudeText) ? claudeText : "";
    const g = isRealAnswer(geminiText) ? geminiText : "";
    return c.length >= g.length ? (c || g) : (g || c);
  }
  return result.text;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  try {
    const { action, question, lang } = JSON.parse(event.body);

    if (action === "optimize") {
      const prompt = `أنت خبير في صياغة الأسئلة. اقترح 3 صياغات محسّنة وأوضح للسؤال التالي.
${(!lang || lang === "auto")
  ? "اكتب الصياغات المقترحة بنفس لغة السؤال الأصلي تماماً."
  : "اكتب الصياغات المقترحة الثلاث بلغة: " + lang + " فقط."}
أجب فقط بـ JSON: {"suggestions": ["...", "...", "..."]}
السؤال: ${question}`;
      const result = await withTimeout(
        askClaude(prompt, "أنت مساعد صياغة دقيق.", CLAUDE_KEY, CLAUDE_FAST, 500),
        7000
      );
      let suggestions = [];
      try {
        const raw = (result.text || "").replace(/```json|```/g, "").trim();
        suggestions = JSON.parse(raw).suggestions || [];
      } catch {}
      return { statusCode: 200, headers, body: JSON.stringify({ suggestions }) };
    }

    if (action === "ask") {
      // 1. التصنيف السريع
      const category = await classifyQuestion(question, CLAUDE_KEY);
      const expertPrompt = EXPERTS[category] + langInstruction(lang);

      // 2. النموذجان السريعان بالتوازي
      const [claudeRes, geminiRes] = await Promise.all([
        withTimeout(askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_MAIN, 2000), 11000),
        withTimeout(askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_MAIN, 2000), 11000),
      ]);

      // 3. الدمج الذكي (بدون فشل)
      let finalAnswer;
      let mode;

      if (claudeRes.ok && geminiRes.ok) {
        finalAnswer = await mergeAnswers(question, claudeRes.text, geminiRes.text, CLAUDE_KEY, lang);
        mode = "merged";
      } else if (claudeRes.ok) {
        finalAnswer = claudeRes.text;
        mode = "claude_only";
      } else if (geminiRes.ok) {
        finalAnswer = geminiRes.text;
        mode = "gemini_only";
      } else {
        // محاولة أخيرة سريعة جداً بنموذج واحد
        const lastTry = await withTimeout(
          askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_FAST, 1500),
          8000
        );
        finalAnswer = lastTry.ok ? lastTry.text : "تعذّر توليد إجابة كافية لهذا السؤال. حاول تبسيط صياغته أو أعد المحاولة بعد قليل.";
        mode = lastTry.ok ? "retry" : "failed";
      }

      if (!isRealAnswer(finalAnswer)) {
        finalAnswer = claudeRes.text || geminiRes.text || "تعذّر توليد إجابة كافية. أعد صياغة السؤال وحاول مجدداً.";
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer: finalAnswer,
          category,
          mode,
          sources: { claude: claudeRes.ok, gemini: geminiRes.ok },
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
