// ========================================
// ط§ظ„ط¬ط§ظ…ط¹ ط§ظ„ط°ظƒظٹ â€” ط§ظ„ط®ط§ط¯ظ… ط§ظ„ظˆط³ظٹط· ط§ظ„ط¢ظ…ظ† (ظ†ط³ط®ط© ظ…ط­ط³ظ‘ظ†ط© ظ„ظ„ط³ط±ط¹ط©)
// ظٹط®ظپظٹ ظ…ظپط§طھظٹط­ Claude ظˆ Gemini
// ظٹط¯ظٹط±: ط§ظ„طھطµظ†ظٹظپ + ط§ظ„ظ†ظ…ظˆط°ط¬ظٹظ† + ط§ظ„ظ†ظ‚ط§ط´ + ط§ظ„ط¯ظ…ط¬
// ط§ظ„طھط­ط³ظٹظ†: ظ†ظ…ط§ط°ط¬ ط£ط³ط±ط¹ ظ„ظ„ط®ط·ظˆط§طھ ط§ظ„ظˆط³ظٹط·ط© + ط­ظ…ط§ظٹط© ظ…ظ† طھط¬ط§ظˆط² ط§ظ„ظˆظ‚طھ
// ========================================

// ظ†ظ…ط§ط°ط¬ ط³ط±ظٹط¹ط© ظ„ظ„ط®ط·ظˆط§طھ ط§ظ„ظˆط³ظٹط·ط© (طھطµظ†ظٹظپ + ظ†ظ‚ط§ط´)
const CLAUDE_FAST = "claude-haiku-4-5-20251001";
const GEMINI_FAST = "gemini-2.5-flash";
// ظ†ظ…ظˆط°ط¬ ظ‚ظˆظٹ ظ„ظ„ط¥ط¬ط§ط¨ط© ط§ظ„ط£ط³ط§ط³ظٹط© ظˆط§ظ„ط¯ظ…ط¬ ط§ظ„ظ†ظ‡ط§ط¦ظٹ
const CLAUDE_SMART = "claude-sonnet-4-6";
const GEMINI_SMART = "gemini-2.5-flash"; // flash ط£ط³ط±ط¹ ط¨ظƒط«ظٹط± ظˆط¬ظˆط¯طھظ‡ ظ…ظ…طھط§ط²ط©

// ط­ط¯ ط²ظ…ظ†ظٹ ظ„ظƒظ„ ط§ط³طھط¯ط¹ط§ط، (ظ„ظ…ظ†ط¹ طھط¹ظ„ظٹظ‚ ط§ظ„ظˆط¸ظٹظپط©)
const CALL_TIMEOUT = 9000; // 9 ط«ظˆط§ظ†ظچ ظ„ظƒظ„ ط§ط³طھط¯ط¹ط§ط، ظƒط­ط¯ ط£ظ‚طµظ‰

// ط¯ط§ظ„ط© ظ…ط³ط§ط¹ط¯ط©: طھط¶ظٹظپ ظ…ظ‡ظ„ط© ط²ظ…ظ†ظٹط© ظ„ط£ظٹ ط·ظ„ط¨
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, text: "", timedOut: true }), ms)),
  ]);
}

// طھط¹ظ„ظٹظ…ط§طھ ط§ظ„ط®ط¨ط±ط§ط، ط­ط³ط¨ ط§ظ„طھط®طµطµ
const EXPERTS = {
  trading: "ط£ظ†طھ ط®ط¨ظٹط± طھط¯ط§ظˆظ„ ظˆظ…ط­ظ„ظ„ ط£ط³ظˆط§ظ‚ ظ…ط§ظ„ظٹط© ظ…ط­طھط±ظپ. ط­ظ„ظ‘ظ„ ط¨ط¯ظ‚ط© ظ…ط¹ ط°ظƒط± ط§ظ„ظ…ط®ط§ط·ط±. ظ„ط§ طھظ‚ط¯ظ‘ظ… ظ†طµظٹط­ط© ظ…ط§ظ„ظٹط© ظ‚ط§ط·ط¹ط© ط¨ظ„ ظ…ط¹ظ„ظˆظ…ط§طھ ظٹط¨ظ†ظٹ ط¹ظ„ظٹظ‡ط§ ط§ظ„ظ…ط³طھط®ط¯ظ… ظ‚ط±ط§ط±ظ‡.",
  writing: "ط£ظ†طھ ظƒط§طھط¨ ظˆط£ط¯ظٹط¨ ط¹ط±ط¨ظٹ ط¨ط§ط±ط¹طŒ ظ…طھظ…ظƒظ‘ظ† ظ…ظ† ط§ظ„ط£ط³ط§ظ„ظٹط¨ ط§ظ„ط¨ظ„ط§ط؛ظٹط© ظˆط§ظ„ط¥ط¨ط¯ط§ط¹ظٹط© ظˆط§ظ„طµظٹط§ط؛ط© ط§ظ„ط±ط§ظ‚ظٹط©.",
  programming: "ط£ظ†طھ ظ…ظ‡ظ†ط¯ط³ ط¨ط±ظ…ط¬ظٹط§طھ ط®ط¨ظٹط±. ظ‚ط¯ظ‘ظ… ط­ظ„ظˆظ„ط§ظ‹ ط¹ظ…ظ„ظٹط© ظˆط¯ظ‚ظٹظ‚ط© ظ…ط¹ ط´ط±ط­ ظˆط§ط¶ط­ ظˆط£ظ…ط«ظ„ط© ظƒظˆط¯ ظ†ط¸ظٹظپط©.",
  science: "ط£ظ†طھ ط¹ط§ظ„ظ… ظˆط¨ط§ط­ط« ظ…طھط®طµطµ. ظ‚ط¯ظ‘ظ… ظ…ط¹ظ„ظˆظ…ط§طھ ط¯ظ‚ظٹظ‚ط© ظ…ط¨ظ†ظٹط© ط¹ظ„ظ‰ ط§ظ„ط£ط¯ظ„ط© ط§ظ„ط¹ظ„ظ…ظٹط© ط¨ظ„ط؛ط© ظˆط§ط¶ط­ط©.",
  religion: "ط£ظ†طھ ط¨ط§ط­ط« ظ…طھط®طµطµ ظپظٹ ط§ظ„ط¹ظ„ظˆظ… ط§ظ„ط´ط±ط¹ظٹط©طŒ ط¯ظ‚ظٹظ‚ ظˆظ…ظˆط¶ظˆط¹ظٹطŒ طھط°ظƒط± ط§ظ„ط¢ط±ط§ط، ط§ظ„ظ…ط®طھظ„ظپط© ط¨ط§ط­طھط±ط§ظ….",
  health: "ط£ظ†طھ ظ…ط®طھطµ طµط­ظٹ ظٹظ‚ط¯ظ‘ظ… ظ…ط¹ظ„ظˆظ…ط§طھ ط·ط¨ظٹط© ط¹ط§ظ…ط© ظ…ظˆط«ظˆظ‚ط©طŒ ظ…ط¹ ط§ظ„طھظ†ط¨ظٹظ‡ ط¯ط§ط¦ظ…ط§ظ‹ ظ„ظ…ط±ط§ط¬ط¹ط© ط§ظ„ط·ط¨ظٹط¨ ط§ظ„ظ…ط®طھطµ.",
  general: "ط£ظ†طھ ظ…ط³ط§ط¹ط¯ ط°ظƒط§ط، ط§طµط·ظ†ط§ط¹ظٹ ط®ط¨ظٹط± ظˆظ…ظˆط³ظˆط¹ظٹ. ظ‚ط¯ظ‘ظ… ط¥ط¬ط§ط¨ط© ط´ط§ظ…ظ„ط© ظˆط¯ظ‚ظٹظ‚ط© ظˆظ…ظ†ط¸ظ‘ظ…ط© ط¨ط§ظ„ط¹ط±ط¨ظٹط© ط§ظ„ظˆط§ط¶ط­ط©."
};

// ط§ط³طھط¯ط¹ط§ط، Claude (ظ…ط¹ طھط­ط¯ظٹط¯ ط§ظ„ظ†ظ…ظˆط°ط¬)
async function askClaude(question, expertPrompt, apiKey, model = CLAUDE_SMART, maxTokens = 1500) {
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
    return { ok: true, text: (data.content || []).map(b => b.text || "").join("") };
  } catch {
    return { ok: false, text: "" };
  }
}

// ط§ط³طھط¯ط¹ط§ط، Gemini (ظ…ط¹ طھط­ط¯ظٹط¯ ط§ظ„ظ†ظ…ظˆط°ط¬)
async function askGemini(question, expertPrompt, apiKey, model = GEMINI_SMART, maxTokens = 1500) {
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
    return { ok: !!text, text };
  } catch {
    return { ok: false, text: "" };
  }
}

// طھطµظ†ظٹظپ ط§ظ„ط³ط¤ط§ظ„ (ظ†ظ…ظˆط°ط¬ ط³ط±ظٹط¹ + ظ…ظ‡ظ„ط© ظ‚طµظٹط±ط©)
async function classifyQuestion(question, apiKey) {
  const prompt = `طµظ†ظ‘ظپ ط§ظ„ط³ط¤ط§ظ„ ط§ظ„طھط§ظ„ظٹ ط¥ظ„ظ‰ ظˆط§ط­ط¯ط© ظپظ‚ط· ظ…ظ† ظ‡ط°ظ‡ ط§ظ„ظپط¦ط§طھ:
tradingطŒ writingطŒ programmingطŒ scienceطŒ religionطŒ healthطŒ general.
ط£ط¬ط¨ ط¨ظƒظ„ظ…ط© ظˆط§ط­ط¯ط© ظپظ‚ط·.
ط§ظ„ط³ط¤ط§ظ„: ${question}`;
  const result = await withTimeout(
    askClaude(prompt, "ط£ظ†طھ ظ…طµظ†ظ‘ظپ ط¯ظ‚ظٹظ‚.", apiKey, CLAUDE_FAST, 20),
    4000
  );
  if (!result.ok) return "general";
  const category = (result.text || "general").trim().toLowerCase();
  return EXPERTS[category] ? category : "general";
}

// ط¬ظˆظ„ط© ط§ظ„ظ†ظ‚ط§ط´: ظƒظ„ ظ†ظ…ظˆط°ط¬ ظٹظ‚ط±ط£ ط¬ظˆط§ط¨ ط§ظ„ط¢ط®ط±طŒ ظٹظ†طھظ‚ط¯ظ‡ ظˆظٹظƒظ…ظ‘ظ„ ظ†ظ‚طµظ‡
function critiquePrompt(question, ownAnswer, otherAnswer) {
  return `ط±ط§ط¬ط¹ ط¥ط¬ط§ط¨طھظƒ ظ…ظ‚ط§ط±ظ†ط©ظ‹ ط¨ط¥ط¬ط§ط¨ط© ط²ظ…ظٹظ„ ط®ط¨ظٹط± ط¢ط®ط± ط¹ظ„ظ‰ ظ†ظپط³ ط§ظ„ط³ط¤ط§ظ„.
ط§ظ„ط³ط¤ط§ظ„: ${question}
ط¥ط¬ط§ط¨طھظƒ:
${ownAnswer}
ط¥ط¬ط§ط¨ط© ط§ظ„ط²ظ…ظٹظ„:
${otherAnswer}
ظ…ظ‡ظ…طھظƒ: طµط­ظ‘ط­ ط£ظٹ ط®ط·ط£طŒ ط£ط¶ظپ ظ…ط§ ظٹظ†ظ‚طµطŒ ط¹ظ…ظ‘ظ‚ ط§ظ„ظ†ظ‚ط§ط· ط§ظ„ظ…ظ‡ظ…ط©. ظ„ط§ طھظƒط±ط±. ط£ط®ط±ط¬ ظ†ط³ط®طھظƒ ط§ظ„ظ…ظڈط­ط³ظ‘ظ†ط© ظپظ‚ط·:`;
}

// ط¯ظ…ط¬ ط§ظ„ط¥ط¬ط§ط¨طھظٹظ† ط¨ط¹ط¯ ط¬ظˆظ„ط© ط§ظ„ظ†ظ‚ط§ط´
async function mergeAnswers(question, claudeText, geminiText, claudeKey, geminiKey) {
  // ط§ظ„ط¬ظˆظ„ط© 2: ظ†ظ‚ط§ط´ ط³ط±ظٹط¹ ط¨ط§ظ„طھظˆط§ط²ظٹ + ظ…ظ‡ظ„ط© ط²ظ…ظ†ظٹط©
  const [claudeRound2, geminiRound2] = await Promise.all([
    withTimeout(
      askClaude(critiquePrompt(question, claudeText, geminiText), "ط£ظ†طھ ط®ط¨ظٹط± ظ…ط­ظ‚ظ‘ظ‚ ط¯ظ‚ظٹظ‚.", claudeKey, CLAUDE_FAST, 1200),
      8000
    ),
    withTimeout(
      askGemini(critiquePrompt(question, geminiText, claudeText), "ط£ظ†طھ ط®ط¨ظٹط± ظ…ط­ظ‚ظ‘ظ‚ ط¯ظ‚ظٹظ‚.", geminiKey, GEMINI_FAST, 1200),
      8000
    ),
  ]);

  const finalClaude = claudeRound2.ok ? claudeRound2.text : claudeText;
  const finalGemini = geminiRound2.ok ? geminiRound2.text : geminiText;

  // ط§ظ„ط¯ظ…ط¬ ط§ظ„ظ†ظ‡ط§ط¦ظٹ ط¨ظ†ظ…ظˆط°ط¬ ظ‚ظˆظٹ
  const prompt = `ظ„ط¯ظٹظƒ ط¥ط¬ط§ط¨طھط§ظ† ظ…ظ† ط®ط¨ظٹط±ظٹظ† ظ†ط§ظ‚ط´ط§ ط§ظ„ظ…ظˆط¶ظˆط¹. ط£ظ„ظ‘ظپ ط¥ط¬ط§ط¨ط© ظ†ظ‡ط§ط¦ظٹط© ظˆط§ط­ط¯ط© ط¨ظ…ط³طھظˆظ‰ ط¨ط­ط«ظٹ:
- ط§ط¯ظ…ط¬ ط£ط¹ظ…ظ‚ ظ…ط§ ظپظٹظ‡ظ…ط§طŒ ط§ط­ط°ظپ ط§ظ„طھظƒط±ط§ط±طŒ طµط­ظ‘ط­ ط£ظٹ طھط¶ط§ط±ط¨
- ظ†ط¸ظ‘ظ…: ظ…ظ‚ط¯ظ…ط©طŒ طھظپطµظٹظ„طŒ ط®ظ„ط§طµط©. ط¨ط§ظ„ط¹ط±ط¨ظٹط© ط§ظ„ظپطµط­ظ‰ ط§ظ„ظˆط§ط¶ط­ط©.
ط§ظ„ط³ط¤ط§ظ„: ${question}
ط§ظ„ط®ط¨ظٹط± ط§ظ„ط£ظˆظ„:
${finalClaude}
ط§ظ„ط®ط¨ظٹط± ط§ظ„ط«ط§ظ†ظٹ:
${finalGemini}
ط£ط®ط±ط¬ ط§ظ„ط¥ط¬ط§ط¨ط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط© ظپظ‚ط·:`;

  const result = await withTimeout(
    askClaude(prompt, "ط£ظ†طھ ظ…ط­ط±ظ‘ط± ط¨ط­ط«ظٹ ط®ط¨ظٹط±.", claudeKey, CLAUDE_SMART, 2500),
    12000
  );
  // ظ„ظˆ ط§ظ„ط¯ظ…ط¬ ظپط´ظ„ ط£ظˆ طھط£ط®ظ‘ط±طŒ ظ†ط±ط¬ظ‘ط¹ ط£ظپط¶ظ„ ط¥ط¬ط§ط¨ط© ظ…طھط§ط­ط©
  if (!result.ok) return finalClaude || finalGemini;
  return result.text;
}

// ========================================
// ط§ظ„ظ…ط¹ط§ظ„ط¬ ط§ظ„ط±ط¦ظٹط³ظٹ
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

    // طھط­ط³ظٹظ† ط§ظ„ط³ط¤ط§ظ„ (3 طµظٹط§ط؛ط§طھ) â€” ظ†ظ…ظˆط°ط¬ ط³ط±ظٹط¹
    if (action === "optimize") {
      const prompt = `ط£ظ†طھ ط®ط¨ظٹط± ظپظٹ طµظٹط§ط؛ط© ط§ظ„ط£ط³ط¦ظ„ط©. ط§ظ‚طھط±ط­ 3 طµظٹط§ط؛ط§طھ ظ…ط­ط³ظ‘ظ†ط© ظˆط£ظˆط¶ط­ ظ„ظ„ط³ط¤ط§ظ„ ط§ظ„طھط§ظ„ظٹ.
ط£ط¬ط¨ ظپظ‚ط· ط¨ظ€ JSON: {"suggestions": ["...", "...", "..."]}
ط§ظ„ط³ط¤ط§ظ„: ${question}`;
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

    // ط§ظ„ط³ط¤ط§ظ„ ط§ظ„ظƒط§ظ…ظ„: طھطµظ†ظٹظپ â†’ ظ†ظ…ظˆط°ط¬ط§ظ† â†’ ظ†ظ‚ط§ط´ â†’ ط¯ظ…ط¬
    if (action === "ask") {
      // 1. ط§ظ„طھطµظ†ظٹظپ (ط³ط±ظٹط¹)
      const category = await classifyQuestion(question, CLAUDE_KEY);
      const expertPrompt = EXPERTS[category];

      // 2. ط§ظ„ظ†ظ…ظˆط°ط¬ط§ظ† ط¨ط§ظ„طھظˆط§ط²ظٹ (ظ…ط¹ ظ…ظ‡ظ„ط© ظ„ظƒظ„ ظˆط§ط­ط¯)
      const [claudeRes, geminiRes] = await Promise.all([
        withTimeout(askClaude(question, expertPrompt, CLAUDE_KEY, CLAUDE_SMART, 1500), 11000),
        withTimeout(askGemini(question, expertPrompt, GEMINI_KEY, GEMINI_SMART, 1500), 11000),
      ]);

      // 3. ط§ظ„ط¯ظ…ط¬ (ط£ظˆ fallback ظ„ظˆ ظپط´ظ„ ط£ط­ط¯ظ‡ظ…ط§)
      let finalAnswer;
      if (claudeRes.ok && geminiRes.ok) {
        finalAnswer = await mergeAnswers(question, claudeRes.text, geminiRes.text, CLAUDE_KEY, GEMINI_KEY);
      } else if (claudeRes.ok) {
        finalAnswer = claudeRes.text;
      } else if (geminiRes.ok) {
        finalAnswer = geminiRes.text;
      } else {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "ظپط´ظ„ ط§ظ„ط§طھطµط§ظ„ ط¨ط§ظ„ظ†ظ…ط§ط°ط¬. ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰." }) };
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
