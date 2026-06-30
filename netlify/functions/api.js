// ========================================
// الجامع الذكي — الخادم الوسيط الآمن (نسخة محسّنة للسرعة + جودة الإخراج)
// يخفي مفاتيح Claude و Gemini
// يدير: التصنيف + النموذجين + النقاش + الدمج
// التحسين: نماذج أسرع للخطوات الوسيطة + حماية من تجاوز الوقت
// إصلاحات: قطع الإجابة + إزالة المقدمات + منع Markdown + معالجة الردود الفارغة
// ========================================

// نماذج سريعة للخطوات الوسيطة (تصنيف + نقاش)
const CLAUDE_FAST = "claude-haiku-4-5-20251001";
const GEMINI_FAST = "gemini-2.5-flash";
// نموذج قوي للإجابة الأساسية والدمج النهائي
const CLAUDE_SMART = "claude-sonnet-4-6";
const GEMINI_SMART = "gemini-2.5-flash"; // flash أسرع بكثير وجودته ممتازة

// حد زمني لكل استدعاء (لمنع تعليق الوظيفة)
const CALL_TIMEOUT = 9000; // 9 ثوانٍ لكل استدعاء كحد أقصى

// تعليمة عامة تُضاف لكل خبير: تمنع المقدمات وتمنع Markdown
const STYLE_RULES = `
قواعد إلزامية للإخراج:
- ابدأ مباشرة بالإجابة دون أي مقدمة مثل "بصفتي" أو "كمساعد" أو "بكل سرور" أو "بالطبع".
- لا تستخدم رموز Markdown إطلاقاً: لا تستخدم # للعناوين، ولا --- للفواصل، ولا ** للتغميق، ولا \`\`\` للكود إلا إذا كان السؤال عن برمجة فعلاً.
- استخدم نصاً عربياً عادياً منظّماً بفقرات واضحة. للعناوين اكتبها كجملة عادية متبوعة بنقطتين.
- إذا لم تكن متأكداً من الإجابة، قدّم أفضل تحليل ممكن مع توضيح حدود المعرفة، ولا تترك الإجابة فارغة أبداً.`;

// دالة مساعدة: تضيف مهلة زمنية لأي طلب
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, text: "", timedOut: true }), ms)),
  ]);
}

// دالة مساعدة: تتحقق أن النص ليس فارغاً أو قصيراً جداً (إجابة حقيقية)
function isRealAnswer(text) {
  return typeof text === "string" && text.trim().length > 15;
}

// تعليمات الخبراء حسب التخصص (مع إضافة قواعد الأسلوب لكل واحد)
const EXPERTS = {
  trading: "أنت خبير تداول ومحلل أسواق مالية محترف. حلّل بدقة مع ذكر المخاطر. لا تقدّم نصيحة مالية قاطعة بل معلومات يبني عليها المستخدم قراره." + STYLE_RULES,
  writing: "أنت كاتب وأديب عربي بارع، متمكّن من الأساليب البلاغية والإبداعية والصياغة الراقية." + STYLE_RULES,
  programming: "أنت مهندس برمجيات خبير. قدّم حلولاً عملية ودقيقة مع شرح واضح وأمثلة كود نظيفة." + STYLE_RULES,
  science: "أنت عالم وباحث متخصص. قدّم معلومات دقيقة مبنية على الأدلة العلمية بلغة واضحة." + STYLE_RULES,
  religion: "أنت باحث متخصص في العلوم الشرعية، دقيق وموضوعي، تذكر الآراء المختلفة باحترام." + STYLE_RULES,
  health: "أنت مختص صحي يقدّم معلومات طبية عامة موثوقة، مع التنبيه دائماً لمراجعة الطبيب المختص." + STYLE_RULES,
  general: "أنت مساعد ذكاء اصطناعي خبير وموسوعي. قدّم إجابة شاملة ودقيقة ومنظّمة بالعربية الواضحة." + STYLE_RULES
};

// استدعاء Claude (مع تحديد النموذج)
async function askClaude(question, expertPrompt, apiKey, model = CLAUDE_SMART, maxTokens = 3000) {
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

// استدعاء Gemini (مع تحديد النموذج)
async function askGemini(question, expertPrompt, apiKey, model = GEMINI_SMART, maxTokens = 3000) {
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

// تصنيف السؤال (نموذج سريع + مهلة قصيرة)
async function classifyQuestion(question, apiKey) {
  const prompt = `صنّف السؤال التالي إلى واحدة فقط من هذه الفئات:
trading، writing، programming، science، religion، health، general.
أجب بكلمة واحدة فقط.
السؤال: ${question}`;
  const result = await withTimeout(
    askClaude(prompt, "أنت مصنّف دقيق.", apiKey, CLAUDE_FAST, 20),
    4000
  );
  if (!result.ok) return "general";
  const category = (result.text || "general").trim().toLowerCase();
  return EXPERTS[category] ? category : "general";
}

// جولة النقاش: كل نموذج يقرأ جواب الآخر، ينتقده ويكمّل نقصه
function critiquePrompt(question, ownAnswer, otherAnswer) {
  return `راجع إجابتك مقارنةً بإجابة زميل خبير آخر على نفس السؤال.
السؤال: ${question}
إجابتك:
${ownAnswer}
إجابة الزميل:
${otherAnswer}
مهمتك: صحّح أي خطأ، أضف ما ينقص، عمّق النقاط المهمة. لا تكرر. لا تبدأ بأي مقدمة ولا تستخدم رموز Markdown. أخرج نسختك المُحسّنة فقط:`;
}

// دمج الإجابتين بعد جولة النقاش
async function mergeAnswers(question, claudeText, geminiText, claudeKey, geminiKey) {
  // الجولة 2: نقاش سريع بالتوازي + مهلة زمنية
  const [claudeRound2, geminiRound2] = await Promise.all([
    withTimeout(
      askClaude(critiquePrompt(question, claudeText, geminiText), "أنت خبير محقّق دقيق.", claudeKey, CLAUDE_FAST, 2000),
      8000
    ),
    withTimeout(
      askGemini(critiquePrompt(question, geminiText, claudeText), "أنت خبير محقّق دقيق.", geminiKey, GEMINI_FAST, 2000),
      8000
    ),
  ]);

  const finalClaude = claudeRound2.ok ? claudeRound2.text : claudeText;
  const finalGemini = geminiRound2.ok ? geminiRound2.text : geminiText;

  // الدمج النهائي بنموذج قوي
  const prompt = `لديك إجابتان من خبيرين ناقشا الموضوع. ألّف إجابة نهائية واحدة بمستوى بحثي:
- ادمج أعمق ما فيهما، احذف التكرار، صحّح أي تضارب
- نظّم: مقدمة موجزة، تفصيل، خلاصة. بالعربية الفصحى الواضحة.
- لا تبدأ بأي مقدمة عن نفسك. لا تستخدم رموز Markdown إطلاقاً (لا # ولا --- ولا **).
السؤال: ${question}
الخبير الأول:
${finalClaude}
الخبير الثاني:
${finalGemini}
أخرج الإجابة النهائية فقط:`;

  const result = await withTimeout(
    askClaude(prompt, "أنت محرّر بحثي خبير." + STYLE_RULES, claudeKey, CLAUDE_SMART, 4000),
    12000
  );
  // لو الدمج فشل أو تأخّر، نرجّع أفضل إجابة متاحة
  if (!result.ok) return finalClaude || finalGemini;
  return result.text;
}

// ========================================
// المعالج الرئيسي
// ========================================
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
    const { action, question } = JSON.parse(event.body);

    // تحسين السؤال (3 صياغات) — نموذج سريع
    if (action === "optimize") {
      const prompt = `أنت خبير في صياغة الأسئلة. اقترح 3 صياغات محسّنة وأوضح للسؤال التالي.
أجب فقط بـ JSON: {"suggestions": ["...", "...", "..."]}
السؤال: ${question}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: CLAUDE_FAST, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      let suggestions = [];
      try { suggestions = JSON.parse(raw).suggestions || []; } catch {}
      return { statusCode: 200, headers, body: JSON.stringify({ suggestions }) };
    }

    // السؤال الكامل: تصنيف ← نموذجان ← نقاش ← دمج
    if (action === "ask") {
      // 1. التصنيف (سريع)
      const category = await classifyQuestion(question, CLAUDE_KEY);
      const expertPrompt = EXPERTS[category];

      // 2. النموذجان بالتوازي (مع مهلة لكل واحد)
      const [claudeRes, geminiRes] = await Promise.all([
        withTimeout(askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_SMART, 3000), 11000),
        withTimeout(askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_SMART, 3000), 11000),
      ]);

      // 3. الدمج (أو fallback لو فشل أحدهما)
      let finalAnswer;
      if (claudeRes.ok && geminiRes.ok) {
        finalAnswer = await mergeAnswers(question, claudeRes.text, geminiRes.text, CLAUDE_KEY, GEMINI_KEY);
      } else if (claudeRes.ok) {
        finalAnswer = claudeRes.text;
      } else if (geminiRes.ok) {
        finalAnswer = geminiRes.text;
      } else {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "فشل الاتصال بالنماذج. حاول مرة أخرى." }) };
      }

      // حماية أخيرة: لو الإجابة النهائية طلعت فارغة لأي سبب
      if (!isRealAnswer(finalAnswer)) {
        finalAnswer = claudeRes.text || geminiRes.text || "تعذّر توليد إجابة كافية. أعد صياغة السؤال وحاول مجدداً.";
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer: finalAnswer,
          category,
          sources: {
            claude: claudeRes.ok,
            gemini: geminiRes.ok,
          },
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
