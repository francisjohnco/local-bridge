// netlify/functions/edition.js
// Generates and serves The Local Bridge Edition
// POST { action: 'generate' } — AI writes this week's briefs from partner content
// GET  ?action=get             — Returns latest edition from Blobs

import { getStore } from '@netlify/blobs';

const PARTNERS = [
  { name: 'Sioux Falls Revamp',    url: 'https://siouxfallsrevamp.com',          city: 'sioux-falls',  cityName: 'Sioux Falls',   state: 'SD', category: 'home' },
  { name: 'HomeWatchOS',           url: 'https://homewatchos.com',               city: 'nashville',    cityName: 'Nashville',     state: 'TN', category: 'housing' },
  { name: 'UnderstandingDental',   url: 'https://understandingdental.com',       city: 'winter-park',  cityName: 'Winter Park',   state: 'FL', category: 'healthcare' },
  { name: 'Optimum Injury Lawyers',url: 'https://optimuminjurylawyers.com',      city: 'sioux-falls',  cityName: 'Sioux Falls',   state: 'SD', category: 'legal' },
];

function weekLabel() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return now.getFullYear() + '-W' + String(week).padStart(2, '0');
}

async function fetchPartnerSummary(partner) {
  try {
    const r = await fetch(partner.url, { signal: AbortSignal.timeout(5000) });
    const html = await r.text();
    // Extract title and meta description
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const desc  = (html.match(/meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
                   html.match(/meta[^>]+content="([^"]+)"[^>]+name="description"/i) || [])[1] || '';
    // Extract first few headings as topic signals
    const headings = [...html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/gi)]
      .map(m => m[1].trim()).filter(h => h.length > 10 && h.length < 120).slice(0, 3);
    return { title: title.slice(0, 200), desc: desc.slice(0, 400), headings };
  } catch (_) {
    return { title: partner.name, desc: 'Community resource', headings: [] };
  }
}

async function generateBrief(apiKey, partner, context, isFeature) {
  const prompt = isFeature
    ? `You are writing a short press brief for The Local Bridge community intelligence platform.\n\nPartner site: ${partner.name} (${partner.url})\nCity: ${partner.cityName}, ${partner.state}\nCategory: ${partner.category}\nSite context: ${JSON.stringify(context)}\n\nWrite a compelling, specific, honest community brief about something relevant to ${partner.cityName} residents in the ${partner.category} category. Draw on the site's focus area.\n\nReturn ONLY valid JSON:\n{"headline":"Compelling specific headline (max 16 words, no clickbait)","lede":"2-3 sentence opening paragraph written like a smart local journalist. Specific, honest, useful. Max 60 words.","pullQuote":"One sentence that encapsulates the key insight. In quotes. Max 20 words."}`
    : `You are writing a short community brief for The Local Bridge.\n\nPartner: ${partner.name}\nCity: ${partner.cityName}, ${partner.state}\nCategory: ${partner.category}\nContext: ${JSON.stringify(context)}\n\nWrite a very short brief about something relevant to ${partner.cityName} residents.\n\nReturn ONLY valid JSON:\n{"headline":"Compelling specific headline (max 14 words)","text":"1-2 sentence brief. Specific, honest, useful. Max 40 words."}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error('Anthropic API ' + r.status + ': ' + errText.slice(0, 300));
  }
  const d = await r.json();
  const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  try {
    const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean);
  } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

export default async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url    = new URL(req.url);
  const store  = getStore('local-bridge');
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // GET — return latest or specific week edition
  if (req.method === 'GET' || url.searchParams.get('action') === 'get') {
    try {
      const weekParam = url.searchParams.get('week');
      const key = weekParam ? 'edition/' + weekParam : 'edition/latest';
      const edition = await store.get(key, { type: 'json' });
      return Response.json({ ok: true, edition }, { headers: cors });
    } catch (_) {
      return Response.json({ ok: true, edition: null }, { headers: cors });
    }
  }

  // POST — generate new edition
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'generate') return Response.json({ error: 'Unknown action' }, { status: 400, headers: cors });
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503, headers: cors });

  // Rotate feature city based on week number
  const week = weekLabel();
  const weekNum = parseInt(week.split('-W')[1]) || 1;
  const featureIdx = weekNum % PARTNERS.length;
  const featurePartner = PARTNERS[featureIdx];
  const briefPartners  = PARTNERS.filter((_, i) => i !== featureIdx);

  // Fetch partner context
  const featureContext = await fetchPartnerSummary(featurePartner);
  const briefContexts  = await Promise.all(briefPartners.map(p => fetchPartnerSummary(p)));

  // Generate briefs
  const featureContent = await generateBrief(apiKey, featurePartner, featureContext, true);
  const briefContents  = await Promise.all(briefPartners.map((p, i) => generateBrief(apiKey, p, briefContexts[i], false)));

  const edition = {
    week,
    generatedAt: new Date().toISOString(),
    feature: {
      citySlug:   featurePartner.city,
      cityName:   featurePartner.cityName,
      state:      featurePartner.state,
      category:   featurePartner.category,
      source:     featurePartner.name,
      sourceUrl:  featurePartner.url,
      headline:   featureContent?.headline || 'Community Intelligence Brief',
      lede:       featureContent?.lede     || '',
      pullQuote:  featureContent?.pullQuote || '',
    },
    briefs: briefPartners.map((p, i) => ({
      citySlug:  p.city,
      cityName:  p.cityName,
      state:     p.state,
      category:  p.category,
      source:    p.name,
      sourceUrl: p.url,
      headline:  briefContents[i]?.headline || '',
      text:      briefContents[i]?.text     || '',
    })),
  };

  await store.setJSON('edition/latest', edition);
  await store.setJSON('edition/' + week, edition);

  return Response.json({ ok: true, edition }, { headers: cors });
};
