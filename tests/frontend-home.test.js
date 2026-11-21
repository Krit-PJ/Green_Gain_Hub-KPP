/* 2.6.0–2.7.0 homepage = market for farmers and buyers only. The results page and officer sign-in moved to ABM;
   old links and admin.html bookmarks lead there. 2.7.0: no officer/ABM link is shown to farmers and buyers. */
const fs = require('fs'), path = require('path'), vm = require('vm');
function assert(v, m) { if (!v) throw new Error(m); }
const front = path.join(__dirname, '..', 'frontend');
const read = (f) => fs.readFileSync(path.join(front, f), 'utf8');
const html = read('index.html'), admin = read('admin.html'), sso = read('assets/sso-client.js'), config = read('assets/config.js');
const ABM = 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/';
new vm.Script(sso, { filename: 'sso-client.js' });
const inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
new vm.Script(inline, { filename: 'index.html inline' });

// farmers and buyers: sign-in popup, consent, shareable links, SSO — unchanged
['id="loginPhone"', 'id="loginBtn"', 'login();', 'id="hubAuth"', 'id="pdpaCheck"', 'id="mainApp"', 'id="marketPage"'].forEach((s) => assert(html.includes(s), 'market markup missing: ' + s));
assert(/sell: \['register', 'farmer'\]/.test(inline) && /buy: \['register', 'buyer'\]/.test(inline), 'shareable #sell / #buy links');
assert(/GGH_SSO\.market\(u\)/.test(inline) && /fallback\(err\) \? legacy\(\)/.test(inline) && /need_register/.test(inline) && /GGH_SSO\.logout\(\)/.test(inline) && /ssoAutoMarket/.test(inline), 'market sign-in through SSO with fallback');
assert(sso.includes("aud: 'GGH'") && !/function staff\(|ssoStaffLoginServer/.test(sso), 'SSO client: farmers/buyers only');

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
assert(cfg.GGH_CONFIG.BUILD_VERSION === '2.9.0' && cfg.GGH_CONFIG.ABM_URL === ABM && /\/macros\/s\/AKfycby7nbXM[^/]+\/exec$/.test(cfg.GGH_CONFIG.ABM_API_URL), 'config 2.9.0 with ABM links (redirects only)');
assert(html.includes('assets/market.js?v=2.9.0') && html.includes('assets/config.js?v=2.9.0') && html.includes('assets/sso-client.js?v=2.9.0'), 'asset versions 2.9.0');
assert(!/เศษวัสดุ/.test(html), 'wording: วัสดุเหลือใช้ทางการเกษตร');
console.log('PASS: 2.9.0 homepage — market for farmers and buyers only, pictured how-to, no officer links shown, old links and admin.html redirect to ABM');
