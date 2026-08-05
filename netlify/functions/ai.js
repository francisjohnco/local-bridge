// netlify/functions/ai.js
// Multi-model AI proxy — Claude, OpenAI GPT-4o, or Google Gemini.
// Set MODEL_PROVIDER env var to: claude (default) | openai | gemini
// Set the matching API key: ANTHROPIC_API_KEY | OPENAI_API_KEY | GEMINI_API_KEY
//
// All models receive the same { messages, system, max_tokens } payload.
// The response is normalized to Anthropic's content block format so the
// frontend never needs to change when you switch providers.

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const provider = (process.env.MODEL_PROVIDER || 'claude').toLowerCase();
  let body;
  try { body = await req.json(); } catch (_) { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { messages = [], system = '', max_tokens = 1024 } = body;

  try {
    if (provider === 'openai')  return await callOpenAI(messages, system, max_tokens);
    if (provider === 'gemini')  return await callGemini(messages, system, max_tokens);
    return await callClaude(messages, system, max_tokens);   // default
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

/* ---- Claude (Anthropic) ---- */
async function callClaude(messages, system, max_tokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6', max_tokens, system, messages }),
  });
  // Pass through Anthropic's response format unchanged (frontend already handles it)
  const data = await r.json();
  return Response.json(data, { status: r.status });
}

/* ---- OpenAI GPT-4o ---- */
async function callOpenAI(messages, system, max_tokens) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });
  const oai_messages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', max_tokens, messages: oai_messages }),
  });
  const data = await r.json();
  if (!r.ok) return Response.json({ error: data.error?.message || 'OpenAI error' }, { status: r.status });
  // Normalize to Anthropic content block format
  const text = data.choices?.[0]?.message?.content || '';
  return Response.json({ content: [{ type: 'text', text }] });
}

/* ---- Google Gemini ---- */
async function callGemini(messages, system, max_tokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  // Gemini uses a different message format
  const parts = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents: parts, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), generationConfig: { maxOutputTokens: max_tokens } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) return Response.json({ error: data.error?.message || 'Gemini error' }, { status: r.status });
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return Response.json({ content: [{ type: 'text', text }] });
}
