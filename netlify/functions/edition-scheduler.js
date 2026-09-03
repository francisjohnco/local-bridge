// netlify/functions/edition-scheduler.js
// Scheduled wrapper — triggers edition generation every Monday 8am UTC
// The actual logic lives in edition.js (HTTP-accessible)

export const config = {
  schedule: '0 8 * * 1',
};

export default async () => {
  const baseUrl = process.env.URL || 'https://thelocalbridge.com';
  try {
    const r = await fetch(baseUrl + '/api/edition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'generate' })
    });
    const d = await r.json();
    console.log('[edition-scheduler] Result:', d.ok ? 'success week ' + (d.edition?.week||'?') : d.error);
  } catch (e) {
    console.error('[edition-scheduler] Error:', e.message);
  }
};
