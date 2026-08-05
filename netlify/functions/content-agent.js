// netlify/functions/content-agent.js
// Content Partner management — all admin actions for content sources
//
// POST { action:'add-partner', partner:{...} }      → save to Blobs, run quality check
// POST { action:'list-partners', cardKey?, slug? }  → list partners from Blobs
// POST { action:'toggle-partner', id, enabled }     → enable/disable
// POST { action:'delete-partner', id }              → remove
// POST { action:'detect-url', url }                 → auto-detect RSS/widget at URL
// POST { action:'quality-check', id }               → re-run quality check
// POST { action:'discover', category, city? }       → AI discovery
// POST { action:'fetch-rss', url, limit? }          → parse RSS feed (with 1hr cache)

import { getStore } from '@netlify/blobs';

// ── Helpers ───────────────────────────────────────────────────────────────
function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── RSS parser ─────────────────────────────────────────────────────────────
async function parseRssFeed(url, limit = 5) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'TheLocalBridge/1.0 (+https://thelocalbridge.com)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Feed returned ${r.status}`);
  const xml = await r.text();

  const parseTag = (str, tag) => {
    const m = str.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
    return m ? (m[1] || m[2] || '').trim() : '';
  };
  const parseHref = (str, tag) => {
    const m = str.match(new RegExp(`<${tag}[^>]*href=["']([^"']+)["']`, 'i'));
    return m ? m[1].trim() : '';
  };

  const items = [];
  const isAtom = xml.includes('<entry');
  const rx = isAtom ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi : /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = rx.exec(xml)) !== null && items.length < limit) {
    const b = m[1];
    const title = parseTag(b, 'title');
    const link  = parseTag(b, 'link') || parseHref(b, 'link');
    const date  = parseTag(b, 'pubDate') || parseTag(b, 'published') || parseTag(b, 'updated');
    const desc  = parseTag(b, 'description') || parseTag(b, 'summary') || parseTag(b, 'content');
    if (title && link) items.push({
      title: title.slice(0, 140),
      url: link,
      date: date ? new Date(date).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '',
      description: desc.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0, 250),
    });
  }
  return items;
}

// ── URL auto-detect ────────────────────────────────────────────────────────
async function detectUrl(rawUrl) {
  const base = rawUrl.replace(/\/$/, '');
  const result = { feedUrl: null, contentType: null, widgetCode: null, notes: '' };

  // 1. Try common RSS paths
  const rssAttempts = [
    base + '/feed', base + '/feed.xml', base + '/rss.xml',
    base + '/rss', base + '/atom.xml', base + '/blog/feed',
    base + '/news/feed', base + '/articles/feed',
  ];

  for (const url of rssAttempts) {
    try {
      const r = await fetch(url, { headers:{'User-Agent':'TheLocalBridge/1.0'}, signal:AbortSignal.timeout(4000) });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && (ct.includes('xml') || ct.includes('rss') || ct.includes('atom'))) {
        result.feedUrl = url;
        result.contentType = 'rss';
        result.notes = `RSS feed found at ${url}`;
        return result;
      }
    } catch (_) {}
  }

  // 2. Parse HTML for <link rel="alternate" type="application/rss+xml">
  try {
    const r = await fetch(base, { headers:{'User-Agent':'TheLocalBridge/1.0'}, signal:AbortSignal.timeout(6000) });
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)
             || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i);
      if (m) {
        const feedUrl = m[1].startsWith('http') ? m[1] : base + m[1];
        result.feedUrl = feedUrl;
        result.contentType = 'rss';
        result.notes = `RSS feed discovered in page HTML at ${feedUrl}`;
        return result;
      }
      // Check for widget embed code patterns
      if (html.includes('widget.js') || html.includes('embed.js') || html.includes('data-mode')) {
        result.contentType = 'widget';
        result.notes = 'This site appears to have an embeddable widget. Check their /embed page for the code.';
        return result;
      }
      result.contentType = 'manual';
      result.notes = 'No RSS feed or widget detected. You can still add this as a manual curation source.';
    }
  } catch (e) {
    result.notes = 'Could not reach this URL. Check it is publicly accessible.';
  }

  return result;
}

// ── Quality check via Claude ───────────────────────────────────────────────
async function runQualityCheck(partner, apiKey) {
  let sample = [];
  if (partner.contentType === 'rss' && partner.feedUrl) {
    try { sample = await parseRssFeed(partner.feedUrl, 3); } catch (_) {}
  }

  if (!apiKey) return { score:'unknown', notes:'ANTHROPIC_API_KEY not set — quality check unavailable.', sample };

  const prompt = `You are a content quality reviewer for The Local Bridge, a community intelligence platform serving US residents.

A content partner wants to provide articles for the "${partner.cardKey}" resource card.
Partner: ${partner.name}
Website: ${partner.websiteUrl}
Description: ${partner.description || 'Not provided'}
${sample.length ? `\nSample articles from their feed:\n${sample.map((a,i)=>`${i+1}. "${a.title}" — ${a.description}`).join('\n')}` : ''}

Evaluate whether this content partner is a good fit. Consider:
1. Is the content helpful and relevant for residents using the "${partner.cardKey}" card?
2. Is it consumer-focused (not trade/B2B content)?
3. Does it appear trustworthy and professionally written?
4. Is it fresh/recent content (not years old)?
5. Would a resident find this genuinely useful?

Return ONLY valid JSON:
{"score":"high|medium|low","recommendation":"approve|review|reject","notes":"2-3 sentences explaining the rating and any concerns","relevant":true|false}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:300, messages:[{role:'user',content:prompt}] }),
    });
    const data = await r.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
    const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    return { ...parsed, sample };
  } catch (_) {
    return { score:'unknown', recommendation:'review', notes:'Quality check could not be completed. Review manually.', sample };
  }
}

// ── AI source discovery ────────────────────────────────────────────────────
const CATEGORY_CONTEXTS = {
  'home-watch':'home watch services, property monitoring, vacation home management',
  'healthcare':'primary care, family medicine, community health, patient resources',
  'dentists':'dental care, oral health, dentistry, dental hygiene',
  'legal':'legal aid, tenant rights, consumer law, legal resources',
  'financial':'personal finance, budgeting, credit, savings, financial literacy',
  'housing':'real estate, home buying, mortgage, renting, affordable housing',
  'seniors':'senior care, aging in place, retirement, elder resources',
  'youth':'youth programs, after school, child development, teen activities',
  'schools':'K-12 education, school districts, parent resources, education',
  'parks':'parks and recreation, outdoor activities, trails, community spaces',
  'events':'community events, local happenings, city calendar',
  'home-services':'home repair, contractors, home maintenance, home improvement',
  'roofing':'roofing, roof repair, roof replacement, roofing materials',
  'flooring':'flooring installation, hardwood, LVP, tile, carpet',
  'windows':'window replacement, energy efficient windows, window installation',
  'home-improvement':'home renovation, DIY, remodeling, home projects',
  'emergency':'emergency preparedness, disaster readiness, home safety',
  'farmers-markets':'farmers markets, local food, CSA, seasonal produce',
};

async function discoverSources(category, city, apiKey) {
  if (!apiKey) return [];
  const context = CATEGORY_CONTEXTS[category] || category;
  const prompt = `Find 4-5 authoritative content publishers for the "${category}" resource card (topic: ${context}).
${city ? `City: ${city}` : 'Focus on national publishers.'}

Criteria: legitimate publisher, consumer-focused, has RSS feed or embed widget, produces genuinely helpful content for residents.

Return ONLY valid JSON:
{"sources":[{"name":"...","url":"...","feedUrl":"...","type":"rss|widget|api","topic":"...","reason":"...","priority":"high|medium|low"}]}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:800,
        tools:[{type:'web_search_20250305',name:'web_search'}],
        messages:[{role:'user',content:prompt}] }),
    });
    const data = await r.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
    return JSON.parse(text.replace(/```json|```/g,'').trim()).sources || [];
  } catch (_) { return []; }
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:cors() });

  try {
    const body   = await req.json().catch(() => ({}));
    const store  = getStore('local-bridge');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const { action } = body;

    // ── ADD PARTNER ───────────────────────────────────────────────────────
    if (action === 'add-partner') {
      const { partner } = body;
      if (!partner?.name || !partner?.cardKey) {
        return Response.json({ error:'name and cardKey are required' }, { status:400, headers:cors() });
      }
      const id = uid();
      const record = {
        id, ...partner,
        enabled:    false,  // starts disabled until quality check
        addedAt:    new Date().toISOString(),
        qualityScore: 'pending',
        qualityNotes: 'Quality check in progress…',
        sampleArticles: [],
      };
      await store.setJSON(`content-partners/${id}`, record);

      // Run quality check async (fire and forget then update)
      const quality = await runQualityCheck(record, apiKey);
      record.qualityScore   = quality.score;
      record.qualityNotes   = quality.notes;
      record.qualityRec     = quality.recommendation;
      record.sampleArticles = quality.sample || [];
      // Auto-enable if quality is high
      if (quality.recommendation === 'approve') record.enabled = true;
      await store.setJSON(`content-partners/${id}`, record);

      return Response.json({ ok:true, id, partner:record, quality }, { headers:cors() });
    }

    // ── LIST PARTNERS ─────────────────────────────────────────────────────
    if (action === 'list-partners') {
      const { cardKey, slug } = body;
      const { blobs } = await store.list({ prefix:'content-partners/' });
      const partners = [];
      for (const b of blobs) {
        try {
          const p = await store.get(b.key, { type:'json' });
          if (!p) continue;
          // Filter by cardKey if provided
          if (cardKey && p.cardKey !== cardKey) continue;
          // Filter by scope: include 'all' sources or city-specific sources matching slug
          if (slug && p.scope === 'city' && p.citySlug && p.citySlug !== slug) continue;
          partners.push(p);
        } catch (_) {}
      }
      // Sort by priority then name
      partners.sort((a,b) => (a.priority||9)-(b.priority||9) || a.name.localeCompare(b.name));
      return Response.json({ ok:true, partners }, { headers:cors() });
    }

    // ── TOGGLE PARTNER ────────────────────────────────────────────────────
    if (action === 'toggle-partner') {
      const { id, enabled } = body;
      if (!id) return Response.json({ error:'id required' }, { status:400, headers:cors() });
      const p = await store.get(`content-partners/${id}`, { type:'json' });
      if (!p) return Response.json({ error:'Partner not found' }, { status:404, headers:cors() });
      p.enabled = !!enabled;
      await store.setJSON(`content-partners/${id}`, p);
      return Response.json({ ok:true, id, enabled:p.enabled }, { headers:cors() });
    }

    // ── DELETE PARTNER ────────────────────────────────────────────────────
    if (action === 'delete-partner') {
      const { id } = body;
      if (!id) return Response.json({ error:'id required' }, { status:400, headers:cors() });
      await store.delete(`content-partners/${id}`);
      return Response.json({ ok:true, deleted:id }, { headers:cors() });
    }

    // ── RE-RUN QUALITY CHECK ──────────────────────────────────────────────
    if (action === 'quality-check') {
      const { id } = body;
      const p = await store.get(`content-partners/${id}`, { type:'json' });
      if (!p) return Response.json({ error:'Partner not found' }, { status:404, headers:cors() });
      const quality = await runQualityCheck(p, apiKey);
      p.qualityScore   = quality.score;
      p.qualityNotes   = quality.notes;
      p.qualityRec     = quality.recommendation;
      p.sampleArticles = quality.sample || [];
      p.lastChecked    = new Date().toISOString();
      await store.setJSON(`content-partners/${id}`, p);
      return Response.json({ ok:true, quality, partner:p }, { headers:cors() });
    }

    // ── DETECT URL ────────────────────────────────────────────────────────
    if (action === 'detect-url') {
      const { url } = body;
      if (!url) return Response.json({ error:'url required' }, { status:400, headers:cors() });
      const result = await detectUrl(url);
      return Response.json({ ok:true, ...result }, { headers:cors() });
    }

    // ── DISCOVER via AI ───────────────────────────────────────────────────
    if (action === 'discover') {
      const { category, city } = body;
      if (!category) return Response.json({ error:'category required' }, { status:400, headers:cors() });
      const sources = await discoverSources(category, city, apiKey);
      return Response.json({ ok:true, category, sources }, { headers:cors() });
    }

    // ── FETCH RSS (with cache) ────────────────────────────────────────────
    if (action === 'fetch-rss') {
      const { url, limit } = body;
      if (!url) return Response.json({ error:'url required' }, { status:400, headers:cors() });
      const cacheKey = `content-sources/rss-cache/${encodeURIComponent(url)}`;
      try {
        const cached = await store.get(cacheKey, { type:'json' });
        if (cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < 3600000) {
          return Response.json({ ok:true, articles:cached.articles, cached:true }, { headers:cors() });
        }
      } catch (_) {}
      const articles = await parseRssFeed(url, limit || 3);
      try { await store.setJSON(cacheKey, { articles, fetchedAt:new Date().toISOString() }); } catch (_) {}
      return Response.json({ ok:true, articles }, { headers:cors() });
    }

    return Response.json({ error:`Unknown action: ${action}` }, { status:400, headers:cors() });

  } catch (err) {
    console.error('[content-agent]', err);
    return Response.json({ error:String(err) }, { status:500, headers:cors() });
  }
};
