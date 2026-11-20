/* 2.5.0–2.7.0 front page for farmers and buyers: markup, old links to ABM, privacy of the public map. */
const fs = require('fs'), path = require('path'), vm = require('vm');
function assert(v, m) { if (!v) throw new Error(m); }
const front = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(front, 'assets', 'market.js'), 'utf8');
const css = fs.readFileSync(path.join(front, 'assets', 'market.css'), 'utf8');
new vm.Script(js, { filename: 'frontend/assets/market.js' });

assert(html.includes('assets/market.js?v=2.8.0') && html.includes('assets/market.css?v=2.8.0') && !html.includes('dashboard.js'), 'market assets 2.8.0, no dashboard.js');
assert(html.includes("document.getElementById('marketPage')?.classList.add('hidden');"), 'signing in hides the market page');
assert(['mkMats', 'mkSide', 'mkDistrict', 'mkNear', 'mkMap', 'mkList', 'mkStats', 'mkView', 'mkDistWrap', 'mkDistTable'].every((id) => html.includes(`id="${id}"`)), 'board controls');

assert(js.includes("endpoint: 'market'") && !/ABM_API|endpoint=residue|state\.results/.test(js), '2.7.0: market data only — no officer numbers (managed area) on this page');
// 2.7.0 dashboard: key numbers, material cards (status, timing, price as given by buyers), districts
assert(['วัสดุประกาศขาย', 'ผู้รับซื้อ', 'อำเภอที่มีการซื้อขาย'].every((t) => js.includes(t)), 'three key numbers');
assert(['มีผู้รับซื้อรอ — ประกาศขายได้เลย', 'มีวัสดุแต่ยังไม่มีผู้รับซื้อ', 'ยังไม่มีประกาศ'].every((t) => js.includes(t)) && js.includes('ตามที่ผู้รับซื้อระบุ'), 'material status and price note');
assert(js.includes("['now', 'ตอนนี้'], ['d30', 'ใน 30 วัน'], ['d90', '31–90 วัน']") && js.includes('sell.timing'), 'harvest timing buckets');
assert(js.includes('data-mat="${g.key}"') && js.includes('data-district=') && js.includes("$('mkDistWrap').open = false"), 'cards and district rows filter the map; table folds on phones');
assert(css.includes('.ggh-mk-mat { flex: 0 0 78%') && css.includes('scroll-snap-type: x'), 'cards scroll sideways on phones');
assert(js.includes("const MOVED = { performance: '', overview: '', crops: '#crops', market: '#market', staff: '#staff', 'staff-register': '#staff-register' }") && js.includes('location.replace(ABM_URL + MOVED[h])'), 'old results/staff links open the same view in ABM');
assert(!/\.phone\b|fname|lname|\.owner/.test(js) && (js.match(/\.name\b/g) || []).length === (js.match(/properties\.name/g) || []).length, 'public page never reads names or phone numbers (only district names)');
assert(js.includes("data-door=\"login\" data-role=\"farmer\"") && js.includes("data-door=\"login\" data-role=\"buyer\""), 'cards lead to the right sign-in');
assert(/is-sell/.test(css) && /is-buy/.test(css) && css.includes('var(--ggh-straw)') && css.includes('var(--ggh-green)'), 'two sides, two colours');
assert(css.includes('@media (max-width: 899px)') && css.includes('[data-view="list"]'), 'map / list toggle on phones');

console.log('PASS: 2.7.0 market front page — key numbers, material cards, timing, districts');
