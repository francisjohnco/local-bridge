// netlify/functions/sitemap.js
// Dynamic XML sitemap — served at /sitemap.xml via netlify.toml redirect
// Lists all city pages, journey pages, and the landing page

const BASE = 'https://thelocalbridge.com';

// All 122 city slugs
const CITY_SLUGS = [
  'bellevue','kirkland','lake-oswego','beaverton','gig-harbor','puyallup','pasadena','santa-monica','san-rafael','walnut-creek','carlsbad','encinitas','cupertino','sunnyvale','roseville','elk-grove','torrance','redondo-beach','berkeley','emeryville','clovis','visalia','fullerton','brea','newport-beach','laguna-niguel','kailua','kaneohe','wasilla','palmer','lakewood','englewood','longmont','erie','sandy','west-jordan','meridian','eagle','henderson','summerlin','winter-park','altamonte-springs','round-rock','cedar-park','sugar-land','the-woodlands','new-braunfels','boerne','southlake','colleyville','edmond','norman','broken-arrow','jenks','evanston','oak-park','carmel','fishers','dublin-oh','powell-oh','franklin','brentwood','alpharetta','roswell','huntersville','matthews','cary','apex','coral-gables','aventura','cambridge','brookline','arlington','bethesda','ponte-vedra-beach','fleming-island','clearwater','dunedin','mount-pleasant','summerville','towson','columbia-md','germantown-tn','collierville','hoover','vestavia-hills','metairie','slidell','henrico','midlothian','boca-raton','pompano-beach','bonita-springs','naples-fl','chesapeake','portsmouth-va','conway','maumelle','high-point','kernersville','overland-park','leawood','eden-prairie','plymouth-mn','papillion','la-vista','ankeny','west-des-moines','clayton-mo','kirkwood-mo','brookfield-wi','wauwatosa','cranston','warwick','zachary-la','denham-springs','parker-co','castle-rock-co','temecula','murrieta','chapel-hill','carrboro',
];



// Card category keys for individual card URLs
const CARD_KEYS = ['neighborhoods','schools','parks','libraries','museums','transportation','utilities','weather','healthcare','dentists','upper-cervical','seniors','youth','pets','home-services','roofing','flooring','windows','home-watch','home-improvement','legal','financial','housing','government','emergency','volunteer','nonprofits','churches','community-orgs','events','farmers-markets','deals'];
const JOURNEY_KEYS = [
  'moving','first-home','retiring','business','kids',
  'emergency','visitor','pets','healthcare-guide','community',
];

function urlTag(loc, priority = '0.7', changefreq = 'weekly') {
  return `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export default async () => {
  const urls = [];

  // Landing page
  urls.push(urlTag(BASE + '/', '1.0', 'daily'));

  // City hubs
  CITY_SLUGS.forEach(slug => {
    urls.push(urlTag(`${BASE}/city/${slug}`, '0.9', 'weekly'));
  });

  // Journey pages
  JOURNEY_KEYS.forEach(key => {
    urls.push(urlTag(`${BASE}/journey/${key}`, '0.6', 'monthly'));
  });

  // Individual card pages — all cities × all card types
  CITY_SLUGS.forEach(slug => {
    CARD_KEYS.forEach(key => {
      urls.push(urlTag(`${BASE}/city/${slug}/${key}`, '0.7', 'weekly'));
    });
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
