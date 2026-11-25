/* 2.6.0–2.7.0 homepage = market for farmers and buyers only. The results page and officer sign-in moved to ABM;
   old links and admin.html bookmarks lead there. 2.7.0: no officer/ABM link is shown to farmers and buyers. */
const fs = require('fs'), path = require('path'), vm = require('vm');
function assert(v, m) { if (!v) throw new Error(m); }
const front = path.join(__dirname, '..', 'frontend');
const read = (f) => fs.readFileSync(path.join(front, f), 'utf8');
const html = read('index.html'), admin = read('admin.html'), config = read('assets/config.js');
const ABM = 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/';
const inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
new vm.Script(inline, { filename: 'index.html inline' });

// farmers and buyers: sign-in popup, consent, shareable links, SSO — unchanged
['id="loginPhone"', 'id="loginBtn"', 'login();', 'id="hubAuth"', 'id="pdpaCheck"', 'id="mainApp"', 'id="marketPage"'].forEach((s) => assert(html.includes(s), 'market markup missing: ' + s));
assert(/sell: \['register', 'farmer'\]/.test(inline) && /buy: \['register', 'buyer'\]/.test(inline), 'shareable #sell / #buy links');
// 2.9.3: farmers and buyers sign in at Green Gain Hub only — phone number straight to loginServer, no central identity hop
assert(/\.loginServer\(\{ action: 'login', username: u \}\)/.test(inline) && !/GGH_SSO|KPP_ID|ssoAutoMarket|need_register/.test(inline), 'direct phone sign-in, no SSO');
// 3.3.0: PIN removed — phone number only at sign-in and registration
assert(!/loginPin|regPin|setPinBox|need_pin|setPinServer|PIN/.test(html) && /provinceCode: f\.province\.value \}\)/.test(inline), '3.3.0 no PIN screens');
// 3.3.0: the three summary tiles sit on top of the district table
assert(html.indexOf('id="mkDistWrap"') < html.indexOf('id="mkStats"') && html.indexOf('id="mkStats"') < html.indexOf('id="mkDistTable"'), '3.3.0 tiles above the district table');
assert(!html.includes('kpp-id.js') && !html.includes('sso-client.js') && !fs.existsSync(path.join(front, 'assets', 'sso-client.js')), 'central identity scripts not loaded');
assert(/Green Gain Hub เท่านั้น/.test(html) && !/ตัวตนกลาง/.test(html), 'PDPA: data used for this system only');

// officer side is gone from this site and points to ABM
['id="loginPage"', 'id="staffAuth"', 'dashboard.js', 'staff-auth.js', 'STAFF_ACCOUNT', 'MARKET_ACCOUNT', 'ABM_STAFF', 'GGH_STAFF'].forEach((x) => assert(!html.includes(x), 'old officer part must be gone: ' + x));
['crop-import.js', 'staff-auth.js', 'dashboard.js', 'sso-client.js'].forEach((f) => assert(!fs.existsSync(path.join(front, 'assets', f)), 'old officer asset removed: ' + f));
// 4.0.0: Green Gain Hub's own officers' page
['admin.js', 'admin.css'].forEach((f) => assert(fs.existsSync(path.join(front, 'assets', f)), '4.0.0 officers asset present: ' + f));
// 2.9.0 "ใช้งานอย่างไร": two paths with 4 pictured steps each, large type; no promise that one sign-up works in other systems
const how = html.slice(html.indexOf('<section class="ggh-how"'), html.indexOf('</section>', html.indexOf('<section class="ggh-how"')));
assert(how && /role="tablist"/.test(how) && how.includes('id="howTabSell"') && how.includes('id="howTabBuy"') && /id="howBuy"[^>]*hidden/.test(how), 'how-to: sell / buy tabs');
assert((how.match(/class="ggh-how-step"/g) || []).length === 8 && (how.match(/<svg class="ggh-how-art"[^>]*aria-hidden="true"/g) || []).length === 8, 'how-to: 4 pictured steps per path (pictures hidden from screen readers)');
assert(how.includes('data-door="login" data-role="farmer" class="ggh-how-go') && how.includes('data-door="login" data-role="buyer" class="ggh-how-go') && how.includes('data-hide-days'), 'how-to: start buttons open sign-in; listing days from the API');
assert(!/ใช้ได้ทั้ง|Agri-Risk Map และ Smart Agri/.test(html), 'no promise that farmers/buyers can use other systems');
const hcss = read('assets/market.css');
assert(/\.ggh-how-step p \{[^}]*font-size: 1\.02rem/.test(hcss) && /\.ggh-how-tab \{[^}]*min-height: 56px/.test(hcss), 'how-to: large text and large touch targets');
const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
assert(!/ggh-mk-perf|data-abm-link|ผลการดำเนินงาน|เจ้าหน้าที่และผู้บริหาร|KPP-Agri-Byproduct-Management/.test(visible), '2.7.0: farmers and buyers see no officer / ABM link');
assert(inline.includes("function openStaff(tab) { location.href = tab === 'register' ? 'admin.html#register' : 'admin.html#login'; }") && !inline.includes('ABM_URL'), '4.0.0: staff doors go to admin.html');
assert(html.includes('id="staffMenu"') && html.includes('href="admin.html#login"') && html.includes('href="admin.html#register"') && html.indexOf('id="staffMenu"') < html.indexOf('</nav>'), '4.0.0: officers menu top right');
assert(/noindex/.test(admin) && admin.includes('id="adLoginForm"') && admin.includes('id="adRegForm"') && admin.includes('id="print-report"') && !admin.includes('KPP-Agri-Byproduct-Management') && !/kpp-id|sso/i.test(admin), '4.0.0: admin.html is the GGH officers page (no SSO, no ABM redirect)');
const cfg = {}; new vm.Script(config).runInNewContext({ window: cfg });
assert(cfg.GGH_CONFIG.BUILD_VERSION === '4.0.0' && cfg.GGH_CONFIG.GEO_BASE === 'geo/' && cfg.GGH_CONFIG.ABM_URL === ABM && /\/macros\/s\/AKfycby7nbXM[^/]+\/exec$/.test(cfg.GGH_CONFIG.ABM_API_URL), 'config 4.0.0 with ABM links (redirects only)');
assert(['market.js', 'config.js', 'api-client.js', 'province.js', 'market.css', 'dashboard.css'].every((f) => html.includes('assets/' + f + '?v=4.0.0')), 'asset versions 4.0.0');
// 3.0.0: every province — the name follows the province on show / the signed-in user
assert(html.includes('Green Gain Hub: จังหวัด<span data-province>') && html.includes('<p class="ggh-topbar-sub">ศูนย์กลางเชื่อมโยงการซื้อ-ขายวัสดุเหลือใช้ทางการเกษตร</p>'), '3.0.0 name and second line');
assert(html.includes('สร้างรายได้จากฟางข้าว ใบอ้อย ซังข้าวโพด แทนการเผา') && html.includes('ศูนย์รวมผู้รับซื้อฟาง ใบอ้อย ซังข้าวโพด เหง้ามัน เก็บเกี่ยวเมื่อใด ต้องการขายหรือต้องการซื้อ ลงทะเบียนแล้วดูตำแหน่งและติดต่อกันได้โดยตรง'), '3.0.0 hero text');
assert(html.includes('id="mkProvince" data-province-select') && html.includes('id="regProvince" name="province"') && /data-province-seal="62"/.test(html), 'province picker, registration province, seal only for its province');
assert(/if \(!f\.province\.value\) miss\.push\('จังหวัด'\)/.test(inline) && /provinceCode: f\.province\.value/.test(inline) && /GGH_PROVINCE\.set\(user\.province, \{ save: false \}\)/.test(inline), 'registration sends the province; sign-in switches to the user province');
assert(/getMatchingDataServer\(\{ province: window\.GGH_PROVINCE/.test(inline), 'signed-in map asks for one province');
assert(!fs.existsSync(path.join(front, 'assets', 'kpp-districts.geojson')) && fs.existsSync(path.join(front, 'geo', 'provinces.json')) && fs.readdirSync(path.join(front, 'geo', 'p')).length === 77, '77 province boundary files replace the Kamphaeng Phet-only file');
assert(!/เศษวัสดุ/.test(html), 'wording: วัสดุเหลือใช้ทางการเกษตร');
console.log('PASS: 3.0.0 homepage — every province (name, picker, registration), direct phone sign-in; — market for farmers and buyers only, pictured how-to, no officer links shown, officers menu top right → admin.html (4.0.0)');
