// netlify/functions/sitemap.js
// Dynamic XML sitemap — served at /sitemap.xml

const BASE = 'https://thelocalbridge.com';

const CITY_SLUGS = ['sioux-falls', 'orlando', 'rapid-city', 'phoenix', 'tampa', 'dallas', 'seattle', 'portland', 'tacoma', 'spokane', 'los-angeles', 'san-francisco', 'san-diego', 'san-jose', 'sacramento', 'long-beach', 'oakland', 'fresno', 'anaheim', 'irvine', 'honolulu', 'anchorage', 'denver', 'boulder', 'fort-collins', 'colorado-springs', 'salt-lake-city', 'boise', 'las-vegas', 'reno', 'albuquerque', 'el-paso', 'tucson', 'mesa', 'scottsdale', 'tempe', 'austin', 'houston', 'san-antonio', 'fort-worth', 'oklahoma-city', 'tulsa', 'chicago', 'indianapolis', 'columbus', 'milwaukee', 'madison', 'kansas-city', 'minneapolis', 'st-paul', 'omaha', 'des-moines', 'st-louis', 'louisville', 'lexington', 'cincinnati', 'cleveland', 'pittsburgh', 'buffalo', 'detroit', 'grand-rapids', 'nashville', 'memphis', 'knoxville', 'chattanooga', 'atlanta', 'charlotte', 'raleigh', 'durham', 'new-orleans', 'richmond', 'virginia-beach', 'birmingham', 'little-rock', 'philadelphia', 'baltimore', 'washington-dc', 'boston', 'jacksonville', 'miami', 'savannah', 'st-petersburg', 'fort-lauderdale', 'cape-coral', 'charleston', 'gilbert', 'chandler', 'missoula', 'billings', 'greensboro', 'norfolk', 'akron', 'lincoln', 'plano', 'lubbock', 'providence', 'baton-rouge', 'aurora', 'bakersfield', 'riverside', 'bellevue', 'kirkland', 'lake-oswego', 'beaverton', 'gig-harbor', 'puyallup', 'pasadena', 'santa-monica', 'san-rafael', 'walnut-creek', 'carlsbad', 'encinitas', 'cupertino', 'sunnyvale', 'roseville', 'elk-grove', 'torrance', 'redondo-beach', 'berkeley', 'emeryville', 'clovis', 'visalia', 'fullerton', 'brea', 'newport-beach', 'laguna-niguel', 'kailua', 'kaneohe', 'wasilla', 'palmer', 'lakewood', 'englewood', 'longmont', 'erie', 'sandy', 'west-jordan', 'meridian', 'eagle', 'henderson', 'summerlin', 'winter-park', 'altamonte-springs', 'round-rock', 'cedar-park', 'sugar-land', 'the-woodlands', 'new-braunfels', 'boerne', 'southlake', 'colleyville', 'edmond', 'norman', 'broken-arrow', 'jenks', 'evanston', 'oak-park', 'carmel', 'fishers', 'dublin-oh', 'powell-oh', 'franklin', 'brentwood', 'alpharetta', 'roswell', 'huntersville', 'matthews', 'cary', 'apex', 'coral-gables', 'aventura', 'cambridge', 'brookline', 'arlington', 'bethesda', 'ponte-vedra-beach', 'fleming-island', 'clearwater', 'dunedin', 'mount-pleasant', 'summerville', 'towson', 'columbia-md', 'germantown-tn', 'collierville', 'hoover', 'vestavia-hills', 'metairie', 'slidell', 'henrico', 'midlothian', 'boca-raton', 'pompano-beach', 'bonita-springs', 'naples-fl', 'chesapeake', 'portsmouth-va', 'conway', 'maumelle', 'high-point', 'kernersville', 'overland-park', 'leawood', 'eden-prairie', 'plymouth-mn', 'papillion', 'la-vista', 'ankeny', 'west-des-moines', 'clayton-mo', 'kirkwood-mo', 'brookfield-wi', 'wauwatosa', 'cranston', 'warwick', 'zachary-la', 'denham-springs', 'parker-co', 'castle-rock-co', 'temecula', 'murrieta', 'chapel-hill', 'carrboro'];

const CARD_KEYS = ['healthcare', 'schools', 'home-services', 'legal', 'housing', 'parks', 'government', 'financial', 'emergency', 'volunteer', 'nonprofits', 'churches', 'events', 'dentists', 'seniors', 'youth', 'pets'];

function urlTag(loc, priority, changefreq) {
  return '  <url>\n    <loc>' + loc + '</loc>\n    <changefreq>' + changefreq + '</changefreq>\n    <priority>' + priority + '</priority>\n  </url>';
}

export default async () => {
  const urls = [];

  // Homepage
  urls.push(urlTag(BASE + '/', '1.0', 'daily'));

  // Archive
  urls.push(urlTag(BASE + '/editions', '0.7', 'weekly'));

  // City hubs — all 222
  CITY_SLUGS.forEach(slug => {
    urls.push(urlTag(BASE + '/city/' + slug, '0.9', 'weekly'));
  });

  // Key card pages per city
  CITY_SLUGS.forEach(slug => {
    CARD_KEYS.forEach(key => {
      urls.push(urlTag(BASE + '/city/' + slug + '/' + key, '0.7', 'weekly'));
    });
  });

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
