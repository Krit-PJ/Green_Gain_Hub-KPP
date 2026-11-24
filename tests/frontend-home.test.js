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
assert(/\.loginServer\(\{ action: 'login', username: u, pin: pin \}\)/.test(inline) && !/GGH_SSO|KPP_ID|ssoAutoMarket|need_register/.test(inline), 'direct phone + PIN sign-in, no SSO');
// 3.1.0: PIN at sign-in and registration; old accounts set one once
assert(html.includes('id="loginPin"') && html.includes('id="regPin"') && html.includes('id="regPin2"') && html.includes('id="setPinBox"') && /status === 'need_pin'/.test(inline) && /\.setPinServer\(\{ phone: u, pin: a \}\)/.test(inline) && /pin: f\.pin\.value/.test(inline), '3.1.0 PIN screens');
assert(!html.includes('kpp-id.js') && !html.includes('sso-client.js') && !fs.existsSync(path.join(front, 'assets', 'sso-client.js')), 'central identity scripts not loaded');
assert(/Green Gain Hub เท่านั้น/.test(html) && !/ตัวตนกลาง/.test(html), 'PDPA: data used for this system only');

// officer side is gone from this site and points to ABM
['id="loginPage"', 'id="staffAuth"', 'dashboard.js', 'staff-auth.js', 'STAFF_ACCOUNT', 'MARKET_ACCOUNT', 'ABM_STAFF', 'GGH_STAFF'].forEach((x) => assert(!html.includes(x), 'officer part must be gone: ' + x));
['admin.js', 'admin.css', 'crop-import.js', 'staff-auth.js', 'dashboard.js'].forEach((f) => assert(!fs.existsSync(path.join(front, 'assets', f)), 'officer asset removed: ' + f));
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
assert(inline.includes("function openStaff(tab) { location.href = ABM_URL") && inline.includes("window.GGH_CONFIG?.ABM_URL"), 'any remaining staff door goes to ABM');
assert(admin.includes("location.replace(base + (location.hash || ''))") && admin.includes(ABM + 'admin.html') && /noindex/.test(admin), 'admin.html bookmarks redirect to ABM');
const cfg = {}; new vm.Script(config).runInNewContext({ window: cfg });
assert(cfg.GGH_CONFIG.BUILD_VERSION === '3.1.0' && cfg.GGH_CONFIG.GEO_BASE === 'geo/' && cfg.GGH_CONFIG.ABM_URL === ABM && /\/macros\/s\/AKfycby7nbXM[^/]+\/exec$/.test(cfg.GGH_CONFIG.ABM_API_URL), 'config 3.1.0 with ABM links (redirects only)');
assert(['market.js', 'config.js', 'api-client.js', 'province.js', 'market.css', 'dashboard.css'].every((f) => html.includes('assets/' + f + '?v=3.1.0')), 'asset versions 3.1.0');
// 3.0.0: every province — the name follows the province on show / the signed-in user
assert(html.includes('Green Gain Hub: จังหวัด<span data-province>') && html.includes('<p class="ggh-topbar-sub">ศูนย์กลางเชื่อมโยงการซื้อ-ขายวัสดุเหลือใช้ทางการเกษตร</p>'), '3.0.0 name and second line');
assert(html.includes('สร้างรายได้จากฟางข้าว ใบอ้อย ซังข้าวโพด แทนการเผา') && html.includes('ศูนย์รวมผู้รับซื้อฟาง ใบอ้อย ซังข้าวโพด เหง้ามัน เก็บเกี่ยวเมื่อใด ต้องการขายหรือต้องการซื้อ ลงทะเบียนแล้วดูตำแหน่งและติดต่อกันได้โดยตรง'), '3.0.0 hero text');
assert(html.includes('id="mkProvince" data-province-select') && html.includes('id="regProvince" name="province"') && /data-province-seal="62"/.test(html), 'province picker, registration province, seal only for its province');
assert(/if \(!f\.province\.value\) miss\.push\('จังหวัด'\)/.test(inline) && /provinceCode: f\.province\.value/.test(inline) && /GGH_PROVINCE\.set\(user\.province, \{ save: false \}\)/.test(inline), 'registration sends the province; sign-in switches to the user province');
assert(/getMatchingDataServer\(\{ province: window\.GGH_PROVINCE/.test(inline), 'signed-in map asks for one province');
assert(!fs.existsSync(path.join(front, 'assets', 'kpp-districts.geojson')) && fs.existsSync(path.join(front, 'geo', 'provinces.json')) && fs.readdirSync(path.join(front, 'geo', 'p')).length === 77, '77 province boundary files replace the Kamphaeng Phet-only file');
assert(!/เศษวัสดุ/.test(html), 'wording: วัสดุเหลือใช้ทางการเกษตร');
console.log('PASS: 3.0.0 homepage — every province (name, picker, registration), direct phone sign-in; — market for farmers and buyers only, pictured how-to, no officer links shown, old links and admin.html redirect to ABM');
