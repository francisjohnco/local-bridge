// netlify/functions/checkout.js
// Tiered verified listing checkout
// Coverage: local | regional | state | national
// Business type: community | professional
// Prices auto-created on first use — only STRIPE_SECRET_KEY needed

import { getStore } from '@netlify/blobs';

// Pricing matrix in cents (matches frontend)
const PRICE_MATRIX = {
  local:    { community: 2900,  professional: 8900  },
  regional: { community: 7900,  professional: 19900 },
  state:    { community: 14900, professional: 34900 },
  national: { community: 29900, professional: 69900 },
};

const PRICE_NAMES = {
  local:    { community: 'Local Community',    professional: 'Local Professional'    },
  regional: { community: 'Regional Community', professional: 'Regional Professional' },
  state:    { community: 'State Community',    professional: 'State Professional'    },
  national: { community: 'National Community', professional: 'National Professional' },
};

async function stripeReq(key, path, body) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await r.json();
  if (data.error) throw new Error('[Stripe] ' + data.error.message);
  return data;
}

// Get or auto-create all 8 Stripe prices, cached in Blobs
async function getPriceId(stripeKey, store, coverage, bizType) {
  const cacheKey = 'stripe/prices/' + coverage + '-' + bizType;
  try {
    const cached = await store.get(cacheKey, { type: 'json' });
    if (cached?.priceId) return cached.priceId;
  } catch (_) {}

  // Create product + price on first use
  const amount = PRICE_MATRIX[coverage][bizType];
  const name   = PRICE_NAMES[coverage][bizType];
  const product = await stripeReq(stripeKey, 'products', {
    name: 'The Local Bridge — ' + name + ' Listing',
    description: 'Verified business listing on The Local Bridge. ' + name + ' tier.',
    'metadata[tier]': coverage + '-' + bizType,
  });
  const price = await stripeReq(stripeKey, 'prices', {
    product: product.id,
    unit_amount: String(amount),
    currency: 'usd',
    'recurring[interval]': 'month',
    nickname: name,
  });
  await store.setJSON(cacheKey, { priceId: price.id, productId: product.id, amount, name, createdAt: new Date().toISOString() });
  console.log('[checkout] Created price:', price.id, name, '$' + (amount/100));
  return price.id;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    const body   = await req.json().catch(() => ({}));
    const { action } = body;
    const stripeKey  = process.env.STRIPE_SECRET_KEY;
    const store      = getStore('local-bridge');
    const baseUrl    = process.env.URL || 'https://thelocalbridge.com';

    // ── Create checkout session ──────────────────────────────────────────
    if (action === 'create-session') {
      const { business } = body;
      if (!business?.name || !business?.email || !business?.cardKey || !business?.city) {
        return Response.json({ error: 'name, email, cardKey and city are required' }, { status: 400, headers: cors() });
      }

      const coverage = business.coverage || 'local';
      const bizType  = business.bizType  || 'community';

      if (!stripeKey) {
        return Response.json({ ok: true, demo: true,
          message: 'Add STRIPE_SECRET_KEY in Netlify → Site Settings → Environment Variables. The system creates all pricing tiers automatically.' },
          { headers: cors() });
      }

      const priceId = await getPriceId(stripeKey, store, coverage, bizType);

      const session = await stripeReq(stripeKey, 'checkout/sessions', {
        'payment_method_types[]':   'card',
        'line_items[0][price]':     priceId,
        'line_items[0][quantity]':  '1',
        mode:                       'subscription',
        customer_email:             business.email,
        // After payment → business dashboard to complete profile
        success_url:                baseUrl + '/business-dashboard?session_id={CHECKOUT_SESSION_ID}&city=' + encodeURIComponent(business.city),
        cancel_url:                 baseUrl + '/city/' + business.city,
        'metadata[business_name]':  business.name,
        'metadata[city_slug]':      business.city,
        'metadata[card_key]':       business.cardKey,
        'metadata[email]':          business.email,
        'metadata[coverage]':       coverage,
        'metadata[biz_type]':       bizType,
        allow_promotion_codes:      'true',
      });

      return Response.json({ ok: true, url: session.url }, { headers: cors() });
    }

    // ── Verify session after payment ─────────────────────────────────────
    if (action === 'verify-session') {
      const { session_id } = body;
      if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400, headers: cors() });
      if (!stripeKey) return Response.json({ error: 'Stripe not configured' }, { status: 503, headers: cors() });

      const session = await stripeReq(stripeKey, 'checkout/sessions/' + session_id);
      const meta    = session.metadata || {};

      if (session.payment_status === 'paid' || session.status === 'complete') {
        const listing = {
          name:           meta.business_name || 'Verified Business',
          citySlug:       meta.city_slug,
          cardKey:        meta.card_key,
          email:          meta.email,
          coverage:       meta.coverage || 'local',
          bizType:        meta.biz_type || 'community',
          verified:       true,
          active:         true,
          sessionId:      session_id,
          subscriptionId: session.subscription,
          paidAt:         new Date().toISOString(),
          // Profile fields filled in later via dashboard
          description:    '',
          website:        '',
          phone:          '',
          hours:          '',
          communityNote:  '',
        };
        const key = 'verified/' + meta.city_slug + '/' + meta.card_key + '/' + session_id;
        await store.setJSON(key, listing);
        return Response.json({ ok: true, listing, listingKey: key }, { headers: cors() });
      }
      return Response.json({ ok: false, status: session.payment_status }, { headers: cors() });
    }

    // ── Update listing profile (from business dashboard) ─────────────────
    if (action === 'update-profile') {
      const { session_id, profile } = body;
      if (!session_id || !profile) return Response.json({ error: 'session_id and profile required' }, { status: 400, headers: cors() });

      // Find the listing in Blobs
      const { blobs } = await store.list({ prefix: 'verified/' }).catch(() => ({ blobs: [] }));
      let found = null, foundKey = null;
      for (const b of blobs) {
        try {
          const l = await store.get(b.key, { type: 'json' });
          if (l?.sessionId === session_id) { found = l; foundKey = b.key; break; }
        } catch (_) {}
      }
      if (!found) return Response.json({ error: 'Listing not found' }, { status: 404, headers: cors() });

      // Update profile fields only
      const safe = {
        ...found,
        description:   String(profile.description || '').slice(0, 500),
        website:       String(profile.website || '').slice(0, 200),
        phone:         String(profile.phone || '').slice(0, 30),
        hours:         String(profile.hours || '').slice(0, 200),
        communityNote: String(profile.communityNote || '').slice(0, 600),
        updatedAt:     new Date().toISOString(),
      };
      await store.setJSON(foundKey, safe);
      return Response.json({ ok: true, listing: safe }, { headers: cors() });
    }

    // ── List verified listings ────────────────────────────────────────────
    if (action === 'list-verified') {
      const { city, cardKey } = body;
      const prefix = city && cardKey ? `verified/${city}/${cardKey}/`
                   : city            ? `verified/${city}/`
                   :                   'verified/';
      const { blobs } = await store.list({ prefix }).catch(() => ({ blobs: [] }));
      const listings = [];
      for (const b of blobs) {
        try {
          const l = await store.get(b.key, { type: 'json' });
          if (l?.verified && l?.active) listings.push(l);
        } catch (_) {}
      }
      return Response.json({ ok: true, listings }, { headers: cors() });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400, headers: cors() });

  } catch (err) {
    console.error('[checkout]', err);
    return Response.json({ error: String(err) }, { status: 500, headers: cors() });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
