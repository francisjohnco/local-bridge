// netlify/edge-functions/prerender.js
// Intercepts crawler requests and returns pre-rendered HTML
// Makes every city page and resource card truly indexable

const BOT_PATTERNS = /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot|semrushbot|ahrefsbot|mj12bot|dotbot/i;

// Convert slug to title case city name
function slugToName(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Map card keys to readable names
const CARD_NAMES = {
  healthcare:'Healthcare', dentists:'Dentists', 'mental-health':'Mental Health',
  'home-services':'Home Services', housing:'Housing', schools:'Schools',
  legal:'Legal Resources', 'personal-injury':'Personal Injury Law',
  financial:'Financial Resources', government:'Government Services',
  emergency:'Emergency Services', parks:'Parks & Recreation',
  restaurants:'Restaurants', shopping:'Shopping', events:'Events',
  volunteer:'Volunteer Opportunities', nonprofits:'Nonprofits',
  churches:'Churches & Faith', libraries:'Libraries', museums:'Museums',
  'farmers-markets':'Farmers Markets', 'community-orgs':'Community Organizations',
  youth:'Youth Programs', seniors:'Senior Resources', pets:'Pet Services',
  jobs:'Jobs & Employment', 'small-business':'Small Business',
  transportation:'Transportation', utilities:'Utilities',
  'real-estate':'Real Estate', childcare:'Childcare',
  'home-improvement':'Home Improvement', insurance:'Insurance',
  automotive:'Automotive', 'personal-injury-law':'Personal Injury Law',
};

export default async function(request, context) {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_PATTERNS.test(ua)) return; // Pass through to normal SPA

  const url  = new URL(request.url);
  const path = url.pathname;

  // Handle city pages, edition pages, and archive
  const isCity     = path.startsWith('/city/');
  const isEdition  = path.startsWith('/edition/');
  const isArchive  = path === '/editions';
  if (!isCity && !isEdition && !isArchive) return;

  const parts    = path.split('/').filter(Boolean);

  // Archive page
  if (isArchive) {
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Edition Archive | The Local Bridge</title>' +
      '<meta name="description" content="Every week of community intelligence from The Local Bridge — 222 cities, sourced and summarized. Browse all past issues.">' +
      '<link rel="canonical" href="https://thelocalbridge.com/editions">' +
      '<meta property="og:title" content="Edition Archive | The Local Bridge">' +
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"The Local Bridge Edition Archive","url":"https://thelocalbridge.com/editions","description":"Community intelligence archive covering 222 US cities."}</script>' +
      '</head><body><h1>The Local Bridge Edition Archive</h1><p>Every week of community intelligence — 222 cities, sourced and summarized. Browse all past issues of The Local Bridge Edition.</p>' +
      '<p><a href="https://thelocalbridge.com">The Local Bridge — The local knowledge nobody writes down.</a></p></body></html>',
      { status:200, headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=3600'} }
    );
  }

  // Edition article page
  if (isEdition) {
    const weekSlug = parts[1] || 'latest';
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>The Local Bridge Edition ' + weekSlug + '</title>' +
      '<meta name="description" content="This week's community intelligence from The Local Bridge — local insights, sourced from trusted partners, summarized for residents.">' +
      '<link rel="canonical" href="https://thelocalbridge.com/edition/' + weekSlug + '">' +
      '<meta property="og:title" content="The Local Bridge Edition ' + weekSlug + '">' +
      '</head><body><h1>The Local Bridge Edition</h1><p>Community intelligence for residents — local insights sourced and summarized from trusted community partners.</p>' +
      '<p><a href="https://thelocalbridge.com/editions">Browse all editions</a> | <a href="https://thelocalbridge.com">The Local Bridge</a></p></body></html>',
      { status:200, headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=3600'} }
    );
  }

  const citySlug = parts[1] || '';
  const cardKey  = parts[2] || '';
  const cityName = slugToName(citySlug);
  const cardName = CARD_NAMES[cardKey] || slugToName(cardKey);

  // Build page-specific meta
  const title = cardKey
    ? `${cardName} in ${cityName} | The Local Bridge`
    : `${cityName} Community Hub | The Local Bridge`;

  const description = cardKey
    ? `${cardName} resources and expert guides for ${cityName} residents — trusted local information, step-by-step guidance, and verified sources from The Local Bridge.`
    : `The Local Bridge for ${cityName} — community intelligence covering healthcare, schools, housing, legal resources, local businesses, events and everything residents need to know. Ask Alpha anything about ${cityName}.`;

  const canonical = `https://thelocalbridge.com${path}`;

  const schema = cardKey ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": title,
    "description": description,
    "url": canonical,
    "isPartOf": { "@type": "WebSite", "name": "The Local Bridge", "url": "https://thelocalbridge.com" }
  }) : JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": title,
    "description": description,
    "url": canonical,
    "about": { "@type": "City", "name": cityName },
    "isPartOf": { "@type": "WebSite", "name": "The Local Bridge", "url": "https://thelocalbridge.com" }
  });

  const prerenderedHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="The Local Bridge">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${schema}</script>
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
${cardKey ? `<p>Find trusted ${cardName} information for ${cityName} including expert guides, local resources, step-by-step guidance, and verified sources.</p>` : `<p>The Local Bridge is your community intelligence hub for ${cityName} — covering healthcare, schools, housing, legal resources, home services, local businesses, events, parks, and everything residents need. Ask Alpha, our AI city guide, anything about ${cityName}.</p>`}
<p><a href="https://thelocalbridge.com">The Local Bridge — The local knowledge nobody writes down.</a></p>
</body>
</html>`;

  return new Response(prerenderedHTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Prerendered': '1',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

export const config = {
  path: ['/city/*', '/edition/*', '/editions']
};
