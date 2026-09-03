// netlify/functions/status.js
// Health check endpoint — fetchable by anyone with the right token
// GET /api/status?token=lb2026

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const url    = new URL(req.url);
  const token  = url.searchParams.get('token');

  // Simple token gate so it's not fully public
  if (token !== 'lb2026') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = {
    timestamp: new Date().toISOString(),
    systems: {}
  };

  // ── 1. Anthropic API key ─────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    results.systems.alpha = { status: 'missing', message: 'ANTHROPIC_API_KEY not set in Netlify env vars' };
  } else {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with: ok' }]
        })
      });
      const d = await r.json();
      if (d.content && d.content[0]?.text) {
        results.systems.alpha = { status: 'live', message: 'Anthropic API responding — Alpha is active', model: 'claude-haiku-4-5' };
      } else {
        results.systems.alpha = { status: 'error', message: d.error?.message || 'Unexpected response', raw: JSON.stringify(d).slice(0,200) };
      }
    } catch (e) {
      results.systems.alpha = { status: 'error', message: String(e) };
    }
  }

  // ── 2. Netlify Blobs ─────────────────────────────────────────────────
  try {
    const store = getStore('local-bridge');
    await store.setJSON('status-ping', { ping: true, at: new Date().toISOString() });
    const check = await store.get('status-ping', { type: 'json' });
    results.systems.blobs = check?.ping
      ? { status: 'live', message: 'Netlify Blobs read/write working' }
      : { status: 'error', message: 'Blobs write succeeded but read returned empty' };
  } catch (e) {
    results.systems.blobs = { status: 'error', message: String(e) };
  }

  // ── 3. Stripe ────────────────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  results.systems.stripe = stripeKey
    ? { status: 'configured', message: 'STRIPE_SECRET_KEY present — checkout active' }
    : { status: 'missing', message: 'STRIPE_SECRET_KEY not set — checkout in demo mode' };

  // ── 4. Content stats from Blobs ──────────────────────────────────────
  try {
    const store = getStore('local-bridge');

    // Subscribers
    const subs = await store.list({ prefix: 'subscribers/' }).catch(() => ({ blobs: [] }));
    results.systems.subscribers = { status: 'ok', count: subs.blobs.length };

    // Verified listings
    const listings = await store.list({ prefix: 'verified/' }).catch(() => ({ blobs: [] }));
    results.systems.verifiedListings = { status: 'ok', count: listings.blobs.length };

    // Saved Alpha answers
    const saved = await store.list({ prefix: 'saved/' }).catch(() => ({ blobs: [] }));
    results.systems.savedAnswers = { status: 'ok', count: saved.blobs.length };

    // Card resources
    const cardRes = await store.list({ prefix: 'cardResources/' }).catch(() => ({ blobs: [] }));
    results.systems.cardResources = { status: 'ok', count: cardRes.blobs.length };

    // Gap finder last run
    try {
      const gf = await store.get('reports/gap/latest', { type: 'json' });
      results.systems.gapFinder = gf
        ? { status: 'ok', lastRun: gf.generatedAt, citiesAnalyzed: gf.citiesAnalyzed }
        : { status: 'never_run', message: 'Gap finder has not run yet' };
    } catch (_) {
      results.systems.gapFinder = { status: 'never_run', message: 'No gap finder report found' };
    }

    // Platform settings
    try {
      const settings = await store.get('platform-settings', { type: 'json' });
      results.systems.platformSettings = settings
        ? { status: 'ok', ga4: settings.ga4Id || 'not set', adminPasswordCustom: !!settings.adminPassword }
        : { status: 'defaults', message: 'Using default settings' };
    } catch (_) {
      results.systems.platformSettings = { status: 'defaults' };
    }

  } catch (e) {
    results.systems.contentStats = { status: 'error', message: String(e) };
  }

  // ── 5. Content partners reachability ────────────────────────────────
  const partners = [
    { name: 'HomeWatchOS', url: 'https://homewatchos.com' },
    { name: 'UnderstandingDental', url: 'https://understandingdental.com' },
    { name: 'Sioux Falls Revamp', url: 'https://siouxfallsrevamp.com' },
    { name: 'Optimum Injury Lawyers', url: 'https://optimuminjurylawyers.com' },
  ];
  results.systems.contentPartners = [];
  for (const p of partners) {
    try {
      const r = await fetch(p.url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      results.systems.contentPartners.push({ name: p.name, status: r.ok ? 'reachable' : 'error', httpStatus: r.status });
    } catch (e) {
      results.systems.contentPartners.push({ name: p.name, status: 'unreachable', message: String(e).slice(0,80) });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const critical = ['alpha','blobs'];
  const allOk = critical.every(k => results.systems[k]?.status === 'live');
  results.overall = allOk ? 'healthy' : 'issues_detected';

  return Response.json(results, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};
