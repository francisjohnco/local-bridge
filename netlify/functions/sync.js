// netlify/functions/sync.js
// Key-value store on Netlify Blobs with validation for public contributions.
//
// GET  /api/sync?key=k                    → { key, value }
// GET  /api/sync?action=list&prefix=p     → { items: [{ key, value }] }
// POST /api/sync { key, value }           → { ok, key }          (upsert)
// POST /api/sync { key, patch:{...} }     → { ok, key }          (merge patch)
// POST /api/sync { key, action:"delete" } → { ok, key, deleted }

import { getStore } from '@netlify/blobs';

// ── Key prefixes ──────────────────────────────────────────────────────────
const PUBLIC_WRITE  = /^contrib\/[\w-]+\/\d{13}$/;          // contrib/{slug}/{timestamp}
const PUBLIC_CITY   = /^city-content\/[\w-]+\/[\w]+\/\d{13}$/; // from admin Resources tab
const ADMIN_PREFIXES = ['reports/', 'admin/'];              // blocked from public write

// ── Sanitizer ─────────────────────────────────────────────────────────────
function sanitize(v, maxLen = 500) {
  return String(v ?? '').replace(/<[^>]*>/g, '').replace(/[^\u0020-\u007E\u00A0-\uFFFF]/g, ' ').trim().slice(0, maxLen);
}

const VALID_TYPES = ['place', 'business', 'event', 'champion', 'spotlight', 'nonprofit'];

export default async (req) => {
  const store = getStore('local-bridge');
  const url   = new URL(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    /* ── GET ─────────────────────────────────────────────────────────── */
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');

      if (action === 'list') {
        const prefix = url.searchParams.get('prefix') || '';
        // Block listing admin/report keys from public requests
        if (ADMIN_PREFIXES.some(p => prefix.startsWith(p))) {
          return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors() });
        }
        let cursor, items = [];
        do {
          const page = await store.list({ prefix, cursor });
          for (const { key } of page.blobs) {
            try { const value = await store.get(key, { type: 'json' }); items.push({ key, value }); }
            catch (_) { items.push({ key, value: null }); }
          }
          cursor = page.cursor;
        } while (cursor);
        return Response.json({ items }, { headers: cors() });
      }

      const key = url.searchParams.get('key');
      if (!key) return Response.json({ error: 'key required' }, { status: 400, headers: cors() });
      // Block reading admin keys publicly
      if (ADMIN_PREFIXES.some(p => key.startsWith(p))) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors() });
      }
      const value = await store.get(key, { type: 'json' });
      return Response.json({ key, value: value ?? null }, { headers: cors() });
    }

    /* ── POST ────────────────────────────────────────────────────────── */
    if (req.method === 'POST') {
      const body = await req.json();
      const { key, value, patch, action } = body;
      if (!key || typeof key !== 'string') {
        return Response.json({ error: 'key required' }, { status: 400, headers: cors() });
      }
      if (key.length > 200) {
        return Response.json({ error: 'key too long' }, { status: 400, headers: cors() });
      }

      // ── Delete ────────────────────────────────────────────────────────
      if (action === 'delete') {
        await store.delete(key);
        return Response.json({ ok: true, key, deleted: true }, { headers: cors() });
      }

      // ── Merge patch ───────────────────────────────────────────────────
      if (patch) {
        const existing = await store.get(key, { type: 'json' }) || {};
        await store.setJSON(key, { ...existing, ...patch });
        return Response.json({ ok: true, key }, { headers: cors() });
      }

      // ── Public contribution: contrib/{slug}/{timestamp} ───────────────
      if (key.startsWith('contrib/')) {
        if (!PUBLIC_WRITE.test(key)) {
          return Response.json({ error: 'Invalid contribution key format' }, { status: 400, headers: cors() });
        }
        const slug = key.split('/')[1];
        const name = sanitize(value?.name, 120);
        if (!name) return Response.json({ error: 'name is required' }, { status: 400, headers: cors() });

        const safe = {
          type:   VALID_TYPES.includes(value?.type) ? value.type : 'place',
          city:   sanitize(value?.city || slug, 80),
          name,
          detail: sanitize(value?.detail, 200),
          note:   sanitize(value?.note, 800),
          by:     sanitize(value?.by, 80),
          at:     typeof value?.at === 'string' ? value.at.slice(0, 30) : new Date().toISOString(),
          status: 'pending',   // always pending — admin must approve
          ip:     req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
        };
        await store.setJSON(key, safe);
        return Response.json({ ok: true, key }, { headers: cors() });
      }

      // ── City-content (admin Resources tab) ───────────────────────────
      if (key.startsWith('city-content/')) {
        const safeVal = {
          name:      sanitize(value?.name, 120),
          detail:    sanitize(value?.detail, 200),
          note:      sanitize(value?.note, 800),
          type:      VALID_TYPES.includes(value?.type) ? value.type : 'business',
          status:    ['approved','pending'].includes(value?.status) ? value.status : 'pending',
          addedBy:   sanitize(value?.addedBy, 40),
          ts:        typeof value?.ts === 'number' ? value.ts : Date.now(),
        };
        if (!safeVal.name) return Response.json({ error: 'name is required' }, { status: 400, headers: cors() });
        await store.setJSON(key, safeVal);
        return Response.json({ ok: true, key }, { headers: cors() });
      }

      // ── Generic upsert (e.g. reports/gap/latest from gap-finder) ─────
      await store.setJSON(key, value);
      return Response.json({ ok: true, key }, { headers: cors() });
    }

    return new Response('Method not allowed', { status: 405, headers: cors() });

  } catch (err) {
    console.error('[sync]', err);
    return Response.json({ error: String(err) }, { status: 500, headers: cors() });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
