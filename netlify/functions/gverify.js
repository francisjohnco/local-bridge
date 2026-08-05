// netlify/functions/gverify.js
// Serves Google Search Console HTML verification file
// Admin pastes the code, this function serves it — no redeploy needed

import { getStore } from '@netlify/blobs';

export default async (req) => {
  try {
    const store    = getStore('local-bridge');
    const filename = await store.get('settings/gsc-filename', { type: 'text' });
    if (!filename) return new Response('Not configured', { status: 404 });
    // Google verification file content format
    const content = 'google-site-verification: ' + filename.replace('.html','');
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response('Error: ' + String(e), { status: 500 });
  }
};
