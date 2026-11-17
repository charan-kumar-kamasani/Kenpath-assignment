// AI layer. The rule engine produces the FACTS (flags, amount, recommendation);
// the LLM only turns them into clear Telugu/English prose for the officer.
// If no API key is set or the call fails we fall back to deterministic templates,
// so the workflow never blocks on AI.

const KEY = () => process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

const SYSTEM = `You assist a Mandal Agriculture Officer in Andhra Pradesh processing crop-loss input-subsidy applications.
You are given verified FACTS computed by a rule engine. Write short, plain, respectful text for a busy field officer.
Rules: never change numbers, amounts or the recommendation; never invent facts; Telugu must be simple spoken-register Telugu (not Sanskritised); keep each text under 90 words.
Respond with ONLY a JSON object: {"te": "<Telugu text>", "en": "<English text>"}.`;

const TASKS = {
  docs: 'Summarise the document-verification result and what the officer should check or ask the farmer for.',
  inspection: 'Turn the officer\'s rough field notes and damage % into a formal field inspection report paragraph.',
  eligibility: 'Explain the eligibility decision and the subsidy calculation step by step in simple words.',
  decision: 'Explain the recommended decision and its reasons. State clearly this is a suggestion and the officer decides.',
};

/**
 * @param {'docs'|'inspection'|'eligibility'|'decision'} kind
 * @param {object} facts   rule-engine output (already trusted)
 * @param {{te:string,en:string}} fallback  template text
 * @returns {Promise<{te:string,en:string,source:'claude'|'rules'}>}
 */
export async function narrate(kind, facts, fallback) {
  if (!KEY()) return { ...fallback, source: 'rules' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: 'user', content: `TASK: ${TASKS[kind]}\nFACTS (JSON): ${JSON.stringify(facts)}` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    const raw = data.content?.map((b) => b.text || '').join('') || '';
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (typeof parsed.te !== 'string' || typeof parsed.en !== 'string') throw new Error('bad shape');
    return { te: parsed.te, en: parsed.en, source: 'claude' };
  } catch (err) {
    console.warn(`[ai] ${kind} fell back to templates:`, err.message);
    return { ...fallback, source: 'rules' };
  }
}
