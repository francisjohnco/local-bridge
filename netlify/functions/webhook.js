// netlify/functions/webhook.js
// Handles Stripe webhook events for subscription lifecycle
// Endpoint: /api/webhook  (configure in Stripe dashboard → Webhooks)

import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

function verifyStripeSignature(payload, sig, secret) {
  const parts = sig.split(',').reduce((acc, p) => {
    const [k, v] = p.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const ts = parts.t;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(ts + '.' + payload)
    .digest('hex');
  return parts.v1 === expectedSig;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response('STRIPE_WEBHOOK_SECRET not configured', { status: 500 });
  }

  const payload = await req.text();
  const sig     = req.headers.get('stripe-signature') || '';

  if (!verifyStripeSignature(payload, sig, webhookSecret)) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (_) {
    return new Response('Invalid JSON', { status: 400 });
  }

  const store = getStore('local-bridge');

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (session.payment_status === 'paid') {
          const listing = {
            name:           meta.business_name,
            citySlug:       meta.city_slug,
            cardKey:        meta.card_key,
            email:          meta.email,
            description:    meta.description || '',
            verified:       true,
            active:         true,
            sessionId:      session.id,
            subscriptionId: session.subscription,
            paidAt:         new Date().toISOString(),
          };
          await store.setJSON(`verified/${meta.city_slug}/${meta.card_key}/${session.id}`, listing);
          // Send confirmation email (optional — requires email function)
          console.log(`[webhook] New verified listing: ${meta.business_name} in ${meta.city_slug}/${meta.card_key}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled — deactivate listing
        const sub = event.data.object;
        const { blobs } = await store.list({ prefix: 'verified/' });
        for (const b of blobs) {
          try {
            const l = await store.get(b.key, { type: 'json' });
            if (l?.subscriptionId === sub.id) {
              l.active = false;
              l.cancelledAt = new Date().toISOString();
              await store.setJSON(b.key, l);
              console.log(`[webhook] Deactivated listing for subscription ${sub.id}`);
            }
          } catch (_) {}
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Payment failed — flag listing (grace period before deactivation)
        const invoice = event.data.object;
        console.log(`[webhook] Payment failed for subscription ${invoice.subscription}`);
        break;
      }
    }
  } catch (err) {
    console.error('[webhook] Error processing event:', err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
