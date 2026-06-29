// ========================================
// الجامع الذكي — الخادم الوسيط الآمن
// يخفي مفاتيح Claude و Gemini
// يدير: التصنيف + النموذجين + الدمج
// ========================================

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_MODEL = "gemini-2.5-pro";

// تعليمات الخبراء حسب التخصص
const EXPERTS = {
  trading: "أنت خبير تداول ومحلل أسواق مالية محترف. حلّل بدقة مع ذكر المخاطر. لا تقدّم نصيحة مالية قاطعة بل معلومات يبني عليها المستخدم قراره.",
  writing: "أنت كاتب وأديب عربي بارع، متمكّن من الأساليب البلاغية والإبداعية والصياغة الراقية.",
  programming: "أنت مهندس برمجيات خبير. قدّم حلولاً عملية ودقيقة مع شرح واضح وأمثلة كود نظيفة.",
  science: "أنت عالم وباحث متخصص. قدّم معلومات دقيقة مبنية على الأدلة العلمية بلغة واضحة.",
  religion: "أنت باحث متخصص في العلوم الشرعية، دقيق وموضوعي، تذكر الآراء المختلفة باحترام.",
  health: "أنت مختص صحي يقدّم معلومات طبية عامة موثوقة، مع التنبيه دائماً لمراجعة الطبيب المختص.",
  general: "أنت مساعد ذكاء اصطناعي خبير وموسوعي. قدّم إجابة شاملة ودقيقة ومنظّمة بالعربية الواضحة."
};

// تصنيف السؤال
async function classifyQuestion(question, apiKey) {
  const prompt = `صنّف السؤال التالي إلى واحدة فقط من هذه الفئات:
trading (تداول/مال/استثمار)، writing (كتابة/أدب/تأليف)، programming (برمجة/تقنية)، science (علوم)، religion (دين/شريعة)، health (صحة/طب)، general (عام/غير ذلك).
أجب بكلمة واحدة فقط من القائمة.

السؤال: ${question}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const category = (data.content?.[0]?.text || "general").trim().toLowerCase();
    return EXPERTS[category] ? category : "general";
  } catch {
    return "general";
  }
}

// استدعاء Claude
async function askClaude(question, expertPrompt, apiKey) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        system: expertPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });
    const data = await res.json();
    if (data.error) return { ok: false, text: "" };
    return { ok: true, text: (data.content || []).map(b => b.text || "").join("") };
  } catch {
    return { ok: false, text: "" };
  }
}

// استدعاء Gemini
async function askGemini(question, expertPrompt, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: expertPrompt }] },
        contents: [{ parts: [{ text: question }] }],
      }),
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { ok: !!text, text };
  } catch {
    return { ok: false, text: "" };
  }
}

// جولة النقاش: كل نموذج يقرأ جواب الآخر، ينتقده ويكمّل نقصه
function critiquePrompt(question, ownAnswer, otherAnswer) {
  return `أنت خبير تراجع إجابتك مقارنةً بإجابة زميل خبير آخر على نفس السؤال.
السؤال: ${question}

إجابتك الأولى:
${ownAnswer}

إجابة الزميل الآخر:
${otherAnswer}

مهمتك الآن:
- اعترف بالنقاط الصحيحة التي ذكرها الزميل وفاتتك
- صحّح أي خطأ في إجابتك إن وُجد
- أضف ما ينقص لتغطية الموضوع بعمق أكبر
- لا تكرر، بل كمّل وعمّق

أخرج نسختك المُحسّنة والأعمق:`;
}

// دمج الإجابتين بعد جولة النقاش — إخراج بحثي متكامل
async function mergeAnswers(question, claudeText, geminiText, claudeKey, geminiKey) {
  // الجولة 2: كل نموذج ينتقد ويكمّل (بالتوازي)
  const [claudeRound2, geminiRound2] = await Promise.all([
    askClaude(critiquePrompt(question, claudeText, geminiText), "أنت خبير محقّق دقيق.", claudeKey),
    askGemini(critiquePrompt(question, geminiText, claudeText), "أنت خبير محقّق دقيق.", geminiKey),
  ]);

  const finalClaude = claudeRound2.ok ? claudeRound2.text : claudeText;
  const finalGemini = geminiRound2.ok ? geminiRound2.text : geminiText;

  // الدمج النهائي: تأليف إجابة بحثية متكاملة
  const prompt = `لديك إجابتان مُعمّقتان من خبيرين ناقشا الموضوع وحسّنا إجاباتهما.
مهمتك: تأليف إجابة نهائية واحدة بمستوى بحثي رصين:
- ادمج أعمق ما في الإجابتين
- احذف التكرار تماماً
- صحّح أي تضارب واذكر الأرجح مع السبب
- نظّم الموضوع بمنهجية (مقدمة، تفصيل منظّم، خلاصة)
- اكتب بالعربية الفصحى الواضحة والرصينة

السؤال: ${question}

إجابة الخبير الأول (بعد التعميق):
${finalClaude}

إجابة الخبير الثاني (بعد التعميق):
${finalGemini}

الآن أخرج الإجابة البحثية النهائية المتكاملة فقط:`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return (data.content || []).map(b => b.text || "").join("");
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

    // تحسين السؤال (3 صياغات)
    if (action === "optimize") {
      const prompt = `أنت خبير في صياغة الأسئلة. اقترح 3 صياغات محسّنة وأوضح للسؤال التالي.
أجب فقط بـ JSON: {"suggestions": ["...", "...", "..."]}

السؤال: ${question}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      let suggestions = [];
      try { suggestions = JSON.parse(raw).suggestions || []; } catch {}
      return { statusCode: 200, headers, body: JSON.stringify({ suggestions }) };
    }

    // السؤال الكامل: تصنيف → نموذجان → دمج
    if (action === "ask") {
      // 1. التصنيف
      const category = await classifyQuestion(question, CLAUDE_KEY);
      const expertPrompt = EXPERTS[category];

      // 2. النموذجان بالتوازي
      const [claudeRes, geminiRes] = await Promise.all([
        askClaude(question, expertPrompt, CLAUDE_KEY),
        askGemini(question, expertPrompt, GEMINI_KEY),
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
        return { statusCode: 500, headers, body: JSON.stringify({ error: "فشل الاتصال بالنماذج" }) };
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
