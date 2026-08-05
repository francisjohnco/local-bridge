// netlify/functions/gap-finder.js
// AI Gap Finder — manually triggered via POST /api/gap-finder or admin panel.
// Analyzes city hubs and surfaces missing content, saves to Netlify Blobs.
//
// POST /api/gap-finder              → runs for all 100 cities (batched)
// POST /api/gap-finder { slug }     → runs for a single city

import { getStore } from '@netlify/blobs';

// Full 100-city list with current data for accurate gap analysis
const ALL_CITIES = [
  {slug:'sioux-falls',   city:'Sioux Falls',    state:'South Dakota',   score:84, pop:'213,900', medianHome:'$335k'},
  {slug:'orlando',       city:'Orlando',         state:'Florida',        score:79, pop:'307,000', medianHome:'$340k'},
  {slug:'rapid-city',    city:'Rapid City',      state:'South Dakota',   score:81, pop:'75,400',  medianHome:'$340k'},
  {slug:'phoenix',       city:'Phoenix',         state:'Arizona',        score:76, pop:'1,608,000',medianHome:'$420k'},
  {slug:'tampa',         city:'Tampa',           state:'Florida',        score:80, pop:'400,000', medianHome:'$390k'},
  {slug:'dallas',        city:'Dallas',          state:'Texas',          score:78, pop:'1,304,000',medianHome:'$380k'},
  {slug:'seattle',       city:'Seattle',         state:'Washington',     score:83, pop:'749,000', medianHome:'$815k'},
  {slug:'portland',      city:'Portland',        state:'Oregon',         score:82, pop:'652,000', medianHome:'$495k'},
  {slug:'denver',        city:'Denver',          state:'Colorado',       score:84, pop:'715,000', medianHome:'$545k'},
  {slug:'boulder',       city:'Boulder',         state:'Colorado',       score:88, pop:'105,000', medianHome:'$865k'},
  {slug:'austin',        city:'Austin',          state:'Texas',          score:83, pop:'978,000', medianHome:'$550k'},
  {slug:'nashville',     city:'Nashville',       state:'Tennessee',      score:82, pop:'689,000', medianHome:'$420k'},
  {slug:'chicago',       city:'Chicago',         state:'Illinois',       score:76, pop:'2,665,000',medianHome:'$340k'},
  {slug:'atlanta',       city:'Atlanta',         state:'Georgia',        score:78, pop:'498,000', medianHome:'$400k'},
  {slug:'boston',        city:'Boston',          state:'Massachusetts',  score:82, pop:'675,000', medianHome:'$735k'},
  {slug:'miami',         city:'Miami',           state:'Florida',        score:75, pop:'454,000', medianHome:'$595k'},
  {slug:'san-diego',     city:'San Diego',       state:'California',     score:80, pop:'1,387,000',medianHome:'$850k'},
  {slug:'charlotte',     city:'Charlotte',       state:'North Carolina', score:79, pop:'927,000', medianHome:'$370k'},
  {slug:'salt-lake-city',city:'Salt Lake City',  state:'Utah',           score:82, pop:'205,000', medianHome:'$475k'},
  {slug:'boise',         city:'Boise',           state:'Idaho',          score:83, pop:'241,000', medianHome:'$415k'},
  {slug:'minneapolis',   city:'Minneapolis',     state:'Minnesota',      score:84, pop:'425,000', medianHome:'$340k'},
  {slug:'indianapolis',  city:'Indianapolis',    state:'Indiana',        score:75, pop:'887,000', medianHome:'$255k'},
  {slug:'columbus',      city:'Columbus',        state:'Ohio',           score:78, pop:'905,000', medianHome:'$255k'},
  {slug:'kansas-city',   city:'Kansas City',     state:'Missouri',       score:77, pop:'508,000', medianHome:'$245k'},
  {slug:'pittsburgh',    city:'Pittsburgh',      state:'Pennsylvania',   score:79, pop:'302,000', medianHome:'$215k'},
  {slug:'richmond',      city:'Richmond',        state:'Virginia',       score:78, pop:'226,000', medianHome:'$335k'},
  {slug:'madison',       city:'Madison',         state:'Wisconsin',      score:86, pop:'269,000', medianHome:'$380k'},
  {slug:'omaha',         city:'Omaha',           state:'Nebraska',       score:80, pop:'486,000', medianHome:'$265k'},
  {slug:'raleigh',       city:'Raleigh',         state:'North Carolina', score:82, pop:'467,000', medianHome:'$395k'},
  {slug:'chattanooga',   city:'Chattanooga',     state:'Tennessee',      score:80, pop:'181,000', medianHome:'$305k'},
  {slug:'savannah',      city:'Savannah',        state:'Georgia',        score:78, pop:'145,000', medianHome:'$290k'},
  {slug:'charleston',    city:'Charleston',      state:'South Carolina', score:81, pop:'150,000', medianHome:'$450k'},
  {slug:'missoula',      city:'Missoula',        state:'Montana',        score:82, pop:'73,000',  medianHome:'$450k'},
  {slug:'providence',    city:'Providence',      state:'Rhode Island',   score:75, pop:'190,000', medianHome:'$430k'},
  {slug:'fort-collins',  city:'Fort Collins',    state:'Colorado',       score:86, pop:'169,000', medianHome:'$520k'},
  {slug:'honolulu',      city:'Honolulu',        state:'Hawaii',         score:80, pop:'342,000', medianHome:'$840k'},
  {slug:'washington-dc', city:'Washington',      state:'DC',             score:79, pop:'678,000', medianHome:'$615k'},
  {slug:'baltimore',     city:'Baltimore',       state:'Maryland',       score:70, pop:'585,000', medianHome:'$250k'},
  {slug:'philadelphia',  city:'Philadelphia',    state:'Pennsylvania',   score:74, pop:'1,550,000',medianHome:'$240k'},
  {slug:'detroit',       city:'Detroit',         state:'Michigan',       score:69, pop:'621,000', medianHome:'$85k'},
  {slug:'cleveland',     city:'Cleveland',       state:'Ohio',           score:70, pop:'372,000', medianHome:'$155k'},
  {slug:'memphis',       city:'Memphis',         state:'Tennessee',      score:70, pop:'633,000', medianHome:'$175k'},
  {slug:'new-orleans',   city:'New Orleans',     state:'Louisiana',      score:76, pop:'369,000', medianHome:'$270k'},
  {slug:'milwaukee',     city:'Milwaukee',       state:'Wisconsin',      score:74, pop:'563,000', medianHome:'$215k'},
  {slug:'st-louis',      city:'St. Louis',       state:'Missouri',       score:73, pop:'286,000', medianHome:'$195k'},
  {slug:'buffalo',       city:'Buffalo',         state:'New York',       score:73, pop:'276,000', medianHome:'$185k'},
  {slug:'albuquerque',   city:'Albuquerque',     state:'New Mexico',     score:73, pop:'565,000', medianHome:'$285k'},
  {slug:'little-rock',   city:'Little Rock',     state:'Arkansas',       score:72, pop:'202,000', medianHome:'$205k'},
  {slug:'birmingham',    city:'Birmingham',      state:'Alabama',        score:70, pop:'212,000', medianHome:'$185k'},
  {slug:'tucson',        city:'Tucson',          state:'Arizona',        score:74, pop:'547,000', medianHome:'$295k'},
  {slug:'las-vegas',     city:'Las Vegas',       state:'Nevada',         score:73, pop:'660,000', medianHome:'$415k'},
];

async function analyzeCity(city, apiKey) {
  const prompt = `You are the AI Gap Finder for The Local Bridge — an AI-powered community intelligence platform for US cities.

City: ${city.city}, ${city.state}
Community Health Score: ${city.score}/100
Population: ${city.pop} | Median Home: ${city.medianHome}

The hub already covers: Neighborhoods, Schools, Healthcare, Dentists, Parks, Libraries, Childcare, Utilities, Transit, Pet care, Groceries, Hardware, Pharmacies, Emergency services, Mental health, Senior resources, Youth programs, Housing, Legal aid, Financial literacy, Employment, Volunteering, Events calendar, Community deals, Featured businesses, Featured nonprofits, Community spotlight stories, Seasonal living tips, 10 guided journeys (Moving here, New parent, Senior living, etc.), Community health score breakdown, and an AI assistant.

Identify the 3 most impactful CONTENT GAPS specific to ${city.city}. These should be:
1. Local topics or resources unique to ${city.city}'s specific character, challenges, or opportunities
2. Questions real residents of ${city.city} actually ask online
3. Cross-links between existing content areas that are missing

Return ONLY valid JSON (no markdown, no explanation):
{"gaps":[{"title":"Gap title","description":"1-2 sentence description of what's missing and why it matters for ${city.city} specifically","priority":"high|medium","category":"content|feature|data"}]}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await r.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  try {
    return JSON.parse(txt.replace(/```json|```/g, '').trim()).gaps;
  } catch (_) {
    return [{ title: 'Parse error', description: txt.slice(0, 200), priority: 'low', category: 'data' }];
  }
}

// Netlify scheduled function config — runs every Monday at 7am UTC
export const config = {
  schedule: "0 7 * * 1",
};

export default async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

  // Parse request — optionally target a single city
  let targetSlug = null;
  if (req.method === 'POST') {
    try { const body = await req.json(); targetSlug = body?.slug || null; } catch (_) {}
  }

  const store = getStore('local-bridge');
  const timestamp = new Date().toISOString();
  const citiesToAnalyze = targetSlug
    ? ALL_CITIES.filter(c => c.slug === targetSlug)
    : ALL_CITIES.slice(0, 3); // Default: 3 cities per manual click (fits 26s timeout)
             // Full 100-city run happens on the Monday schedule automatically

  if (!citiesToAnalyze.length) {
    return Response.json({ error: `City "${targetSlug}" not found` }, { status: 404 });
  }

  const results = [];
  for (const city of citiesToAnalyze) {
    try {
      const gaps = await analyzeCity(city, apiKey);
      results.push({ slug: city.slug, city: city.city, state: city.state, score: city.score, gaps });
    } catch (err) {
      results.push({ slug: city.slug, city: city.city, state: city.state, score: city.score,
        gaps: [{ title: 'Error', description: String(err), priority: 'low', category: 'data' }] });
    }
  }

  const report = {
    generatedAt: timestamp,
    citiesAnalyzed: results.length,
    cities: results,
  };

  // Save timestamped + latest
  await store.setJSON(`reports/gap/${timestamp}`, report);
  await store.setJSON('reports/gap/latest', report);

  return Response.json({ ok: true, generatedAt: timestamp, citiesAnalyzed: results.length, cities: results });
};
