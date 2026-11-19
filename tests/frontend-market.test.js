/* 2.5.0–2.6.0 front page for farmers and buyers: markup, old links to ABM, privacy of the public map. */
const fs = require('fs'), path = require('path'), vm = require('vm');
function assert(v, m) { if (!v) throw new Error(m); }
const front = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(front, 'assets', 'market.js'), 'utf8');
const css = fs.readFileSync(path.join(front, 'assets', 'market.css'), 'utf8');
new vm.Script(js, { filename: 'frontend/assets/market.js' });

assert(html.includes('assets/market.js?v=2.6.0') && html.includes('assets/market.css?v=2.6.0') && !html.includes('dashboard.js'), 'market assets 2.6.0, no dashboard.js');
assert(html.includes("document.getElementById('marketPage')?.classList.add('hidden');"), 'signing in hides the market page');
assert(['mkMats', 'mkSide', 'mkDistrict', 'mkNear', 'mkMap', 'mkList', 'mkStats', 'mkView'].every((id) => html.includes(`id="${id}"`)), 'board controls');

assert(js.includes("endpoint: 'market'") && js.includes("ABM_API + '?api=v1&endpoint=residue'"), 'market numbers here, managed area from ABM');
assert(js.includes("const MOVED = { performance: '', overview: '', crops: '#crops', market: '#market', staff: '#staff', 'staff-register': '#staff-register' }") && js.includes('location.replace(ABM_URL + MOVED[h])'), 'old results/staff links open the same view in ABM');
assert(!/\.phone\b|fname|lname|\.owner/.test(js) && (js.match(/\.name\b/g) || []).length === (js.match(/properties\.name/g) || []).length, 'public page never reads names or phone numbers (only district names)');
assert(js.includes("data-door=\"login\" data-role=\"farmer\"") && js.includes("data-door=\"login\" data-role=\"buyer\""), 'cards lead to the right sign-in');
assert(/is-sell/.test(css) && /is-buy/.test(css) && css.includes('var(--ggh-straw)') && css.includes('var(--ggh-green)'), 'two sides, two colours');
assert(css.includes('@media (max-width: 899px)') && css.includes('[data-view="list"]'), 'map / list toggle on phones');

console.log('PASS: 2.6.0 market front page');
