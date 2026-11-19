/* 2.5.0 front page for farmers and buyers: markup, routing to the results page, privacy of the public map. */
const fs = require('fs'), path = require('path'), vm = require('vm');
function assert(v, m) { if (!v) throw new Error(m); }
const front = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(front, 'assets', 'market.js'), 'utf8');
const css = fs.readFileSync(path.join(front, 'assets', 'market.css'), 'utf8');
const dash = fs.readFileSync(path.join(front, 'assets', 'dashboard.js'), 'utf8');
new vm.Script(js, { filename: 'frontend/assets/market.js' });

assert(html.includes('assets/market.js?v=2.5.0') && html.includes('assets/market.css?v=2.5.0') && html.indexOf('market.js') < html.indexOf('dashboard.js?v='), 'market assets linked before dashboard.js');
assert(html.indexOf('id="marketPage"') > 0 && html.indexOf('id="marketPage"') < html.indexOf('id="loginPage"'), 'market page comes first');
assert(/id="loginPage" class="ggh-landing hidden"/.test(html), 'results page hidden until #performance');
assert(/class="ggh-mk-perf" href="#performance"/.test(html) && html.includes('data-goto="market"'), 'links between the two pages');
assert(html.includes("document.getElementById('marketPage')?.classList.add('hidden');"), 'signing in hides the market page too');
assert(['mkMats', 'mkSide', 'mkDistrict', 'mkNear', 'mkMap', 'mkList', 'mkStats', 'mkView'].every((id) => html.includes(`id="${id}"`)), 'board controls');
assert(/staffAuth/.test(html) && html.includes('data-door="staff"'), 'staff sign-in dialog and door unchanged');

assert(js.includes("endpoint: 'market'") && js.includes("endpoint: 'residue'"), 'market + results numbers');
assert(js.includes("PERF_HASHES = ['performance', 'overview', 'crops', 'market']"), 'old tab links still open the results page');
assert(!/\.phone\b|fname|lname|\.owner/.test(js) && (js.match(/\.name\b/g) || []).length === (js.match(/properties\.name/g) || []).length, 'public page never reads names or phone numbers (only district names)');
assert(js.includes("data-door=\"login\" data-role=\"farmer\"") && js.includes("data-door=\"login\" data-role=\"buyer\""), 'cards lead to the right sign-in');
assert(/is-sell/.test(css) && /is-buy/.test(css) && css.includes('var(--ggh-straw)') && css.includes('var(--ggh-green)'), 'two sides, two colours');
assert(css.includes('@media (max-width: 899px)') && css.includes('[data-view="list"]'), 'map / list toggle on phones');

assert(dash.includes('function start()') && dash.includes("$('marketPage')") && dash.includes("'#performance'"), 'results page loads on demand and keeps #performance');
console.log('PASS: 2.5.0 market front page');
