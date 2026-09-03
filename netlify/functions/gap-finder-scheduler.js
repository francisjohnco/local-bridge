// netlify/functions/gap-finder-scheduler.js
// Scheduled wrapper — triggers gap finder every Monday 7am UTC

export const config = {
  schedule: '0 7 * * 1',
};

export default async () => {
  const baseUrl = process.env.URL || 'https://thelocalbridge.com';
  try {
    const r = await fetch(baseUrl + '/api/gap-finder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    const d = await r.json();
    console.log('[gap-finder-scheduler] Result:', d.ok ? 'done' : d.error);
  } catch (e) {
    console.error('[gap-finder-scheduler] Error:', e.message);
  }
};
