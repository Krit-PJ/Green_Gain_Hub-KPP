const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(value, message) { if (!value) throw new Error(message); }
const front = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(front, 'assets', 'dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(front, 'assets', 'dashboard.css'), 'utf8');
const geo = JSON.parse(fs.readFileSync(path.join(front, 'assets', 'kpp-districts.geojson'), 'utf8'));

new vm.Script(js, { filename: 'frontend/assets/dashboard.js' });

// Landing keeps the login contract used by the existing app script.
['id="loginPage"', 'id="loginPhone"', 'id="loginBtn"', 'login();', 'id="hubAuth"', 'id="staffAuth"', 'id="pdpaCheck"'].forEach(s => assert(html.includes(s), 'login markup missing: ' + s));
// 2.2.1: sign-in lives in two popups; no side card, no separate register page, no stacked consent modal.
assert(!html.includes('id="loginCard"') && !html.includes('id="registerPage"') && !html.includes('id="pdpaModal"'), 'old sign-in card / register page / consent modal must be gone');
assert((html.match(/<dialog class="ggh-dialog"/g) || []).length === 2 && (html.match(/data-close aria-label="ปิดหน้าต่าง"/g) || []).length === 2, 'two dialogs, each with a close button');
assert(html.includes('assets/staff-auth.js') && !/name="password"[^>]*type="password"|type="password"/.test(html), 'officer popup uses the shared module and has no password field');
assert(html.includes('admin.html#admin') && /sell: \['register', 'farmer'\]/.test(html), 'admin link and shareable #sell/#buy links');
['id="dashMap"', 'id="dashKpis"', 'id="dashHarvest"', 'id="dashMaterials"', 'id="dashTable"', 'id="dashDistrict"', 'id="dashDistrictSel"',
  'role="tablist"', 'data-tab="overview"', 'data-tab="crops"', 'data-tab="market"', 'id="dashCropMonths"', 'id="dashCropStack"', 'id="dashAsOf"', 'href="admin.html#admin"'].forEach(s => assert(html.includes(s), 'dashboard markup missing: ' + s));
assert(html.includes('assets/dashboard.js?v=2.4.2') && html.includes('assets/dashboard.css?v=2.4.2'), 'dashboard assets are not linked');
assert(html.indexOf('assets/config.js') < html.indexOf('assets/dashboard.js'), 'config must load before the dashboard');

// Dashboard calls only the aggregate endpoint and renders no personal fields.
assert(js.includes("api: 'v1', endpoint: 'summary'") && js.includes("endpoint: 'crop'"), 'dashboard must call the summary and crop endpoints');
// Admin page: crop must be chosen before a file can be picked; admin calls go through POST only.
const admin = fs.readFileSync(path.join(front, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(front, 'assets', 'admin.js'), 'utf8');
new vm.Script(adminJs, { filename: 'frontend/assets/admin.js' });
assert(/id="fileInput"[^>]*disabled/.test(admin), 'file input must start disabled until a crop is chosen');
assert(admin.indexOf('assets/config.js') < admin.indexOf('assets/admin.js') && admin.includes('assets/crop-import.js'), 'admin page scripts missing');
assert(adminJs.includes("method: 'POST'") && !/localStorage/.test(adminJs), 'admin API must use POST and keep the token out of localStorage');
assert(/noindex/.test(admin), 'admin page must not be indexed');
// 1.7.0: footer counter (once per session) and admin reports.
assert(html.includes('id="visitCounter"') && /วันนี้[\s\S]*เดือนนี้[\s\S]*ทั้งหมด/.test(html), 'footer counter markup missing');
assert(js.includes("'ggh_visit_counted'") && js.includes("counted ? 'visits' : 'hit'"), 'counter must hit once per session, then only read');
assert(admin.includes('data-panel="reports"') && admin.includes('id="reportPrint"') && admin.includes('id="reportXlsx"') && admin.includes('id="reportCsv"'), 'report actions missing');
assert(adminJs.includes("'\\ufeff'") && adminJs.includes('reportExportLogServer'), 'CSV must carry a BOM and exports must be logged');
assert(!/getMatchingDataServer|\.phone\b|\.lat\b|\.lng\b/.test(js), 'dashboard must not touch personal or plot-level data');

// Boundaries: 11 Kamphaeng Phet districts with attribution.
assert(geo.features.length === 11 && geo.features.every(f => f.properties.code.startsWith('62')), 'district GeoJSON must hold the 11 Kamphaeng Phet districts');
assert(/CC BY 4\.0/.test(geo.attribution) && /CC BY 4\.0/.test(js), 'boundary data attribution is missing');

assert(css.includes('prefers-reduced-motion'), 'reduced-motion rule missing');
console.log('PASS: public dashboard markup, aggregate-only API use, boundaries and attribution');

// 2.0.0: residue management tab, crop icons on the map, crop cards, recording form and roles.
assert(html.includes('ระบบศูนย์กลางเชื่อมโยงการจัดการวัสดุเหลือใช้ทางการเกษตร'), 'system name missing');
assert(html.includes('id="resCropIcons"') && html.includes('id="resMethods"') && html.includes('id="resFy"'), 'residue tab markup missing');
assert(!/ggh-cropmonths" data-tabs="overview/.test(html), 'old overview cards must be removed from the residue tab');
assert(admin.includes('id="recForm"') && admin.includes('capture="environment"') && admin.includes('name="confirmed"') && admin.includes('id="recGpsBtn"'), 'recording form missing');
assert(admin.includes('value="mini"') && admin.includes('id="adminDistrict"') && admin.includes('id="reportTypes"') && !admin.includes('id="reportAll"'), 'roles / report types (no select-all) missing');
const dash = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'dashboard.js'), 'utf8');
assert(dash.includes("endpoint: 'residue'") && dash.includes('resGhg') && dash.includes('data-province'), 'dashboard must load residue data');
// 2.1.0: top bar name, no hero title, Green Gain Hub brand in the sign-in card, officer sign-in/registration, value.
// 2.2.0: short name on top, full official name in the footer; entry doors; sign-in card for farmers and buyers.
assert(/ggh-topbar-title[^>]*>Green Gain Hub <span data-province>/.test(html) && html.includes('ggh-topbar-sub') && !html.includes('class="ggh-title"'), 'top bar title / hero title');
assert(/<footer[\s\S]*ระบบศูนย์กลางเชื่อมโยงการจัดการวัสดุเหลือใช้ทางการเกษตร/.test(html), 'full official name in the footer');
assert(/ggh-dialog-kicker">สำหรับเกษตรกรและผู้รับซื้อ</.test(html) && html.includes('STAFF_ACCOUNT') && html.includes('MARKET_ACCOUNT') && html.includes('data-to-staff') && html.includes('data-to-hub'), 'wrong-box numbers switch to the other popup');
assert(js.includes('renderDistrictRanking'), 'side panel ranks districts when nothing is selected');
assert(['data-role="farmer"', 'data-role="buyer"', 'data-door="staff"'].every((x) => html.includes(x)) && html.indexOf('ggh-entry') < html.indexOf('ggh-tabs"'), 'entry buttons before the province data');
assert(!/tCO₂e|tCO2e/.test(html + dash) && dash.includes('ตันคาร์บอนไดออกไซด์เทียบเท่า'), 'Thai GHG unit on the homepage');
assert(dash.includes("endpoint: 'balance'") && html.includes('id="resBalance"'), 'residue balance on the homepage');
assert(admin.includes('id="staffLoginForm"') && admin.includes('id="staffRegForm"') && admin.includes('id="regProvinces"') && admin.includes('id="regGroup"'), 'officer sign-in / registration');
assert(admin.includes('name="priceBahtKg"') && admin.includes('name="useGlobalPrice"') && admin.includes('id="priceForm"') && admin.includes('name="countValue"') && dash.includes('มูลค่าที่จัดการได้'), 'value settings and display');
// 2.2.0 admin: task menus, overview, buyer link, print rules.
const adminCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'admin.css'), 'utf8');
assert(/admin: \[\{ key: 'record'[\s\S]*?\{ key: 'account'/.test(adminJs) && (adminJs.match(/\{ key: '(overview|data|reports|users|settings)', label/g) || []).length === 5, 'Admin 4 items, Mini/Super 5 groups');
assert(admin.includes('data-panel="overview"') && admin.includes('id="recBuyer"') && admin.includes('name="soldTonnes"') && adminJs.includes('residueBalanceServer'), 'overview and marketplace link');
assert(adminCss.includes('@page') === false && adminJs.includes('@page wide') && adminCss.includes('page: wide') && adminCss.includes('.print-hide') && adminCss.includes('display: table-header-group'), 'print: named landscape pages, excel-only columns, repeated headers');
assert(!/tCO₂e|tCO2e/.test(admin + adminJs), 'Thai GHG unit on the admin page');

// 2.3.0: one-line hero with three role buttons, scope bar, three tabs, district reports inside ผลการจัดการ, method footer.
assert(html.includes('เชื่อมเกษตรกร ผู้รับซื้อ และเจ้าหน้าที่ เพื่อลดการเผา') && /data-role="farmer"[^>]*>[\s\S]*?ggh-entry-name">ผู้ขาย<[\s\S]*?<\/button>/.test(html) && /data-role="buyer"[^>]*>[\s\S]*?ggh-entry-name">ผู้รับซื้อ<[\s\S]*?<\/button>/.test(html) && /data-door="staff"[^>]*>[\s\S]*?ggh-entry-name">เจ้าหน้าที่<[\s\S]*?<\/button>/.test(html), 'hero line and [ผู้ขาย] [ผู้รับซื้อ] [เจ้าหน้าที่]');
assert(!html.includes('ggh-doors') && !html.includes('id="dashSearch"') && !html.includes('data-tab="reports"') && !html.includes('id="resProgress"') && !html.includes('id="resScope"'), 'old doors, search, reports tab, duplicate progress and scope line are gone');
assert(/data-tab="overview">ผลการจัดการ</.test(html) && /data-tab="crops">การเพาะปลูก</.test(html) && /data-tab="market">ตลาด</.test(html), 'three short tabs');
assert(/ggh-scope-title">ข้อมูลจังหวัด<span data-province>/.test(html) && html.includes('id="resFyRange"') && html.indexOf('id="resFy"') < html.indexOf('ggh-tabs"'), 'scope bar above the tabs');
assert(/id="sarWrap" data-tabs="overview"/.test(html) && html.includes('รายงานประจำสัปดาห์จากอำเภอ') && html.includes('KPP Smart Agri-Materials') && html.includes('id="dashTrend"'), 'Smart Agri section inside ผลการจัดการ');
assert(html.indexOf('id="resMethodNote"') > html.indexOf('id="sarWrap"') && html.includes('วิธีคำนวณและแหล่งข้อมูล') && js.includes('data-open-method'), 'method footer with a link from the GHG card');
assert(js.includes("const TABS = ['overview', 'crops', 'market']") && js.includes("if (tab === 'reports') { tab = 'overview'"), 'old #reports links land on ผลการจัดการ');
['ลดก๊าซเรือนกระจก (ประมาณการ)', 'จากพื้นที่ที่ไม่เผา', 'ปริมาณที่จัดการ', 'ประมาณการชีวมวล จากพื้นที่ × อัตราต่อไร่', 'มูลค่าที่จัดการได้ (ประมาณการ)', 'ราคากลาง', 'ggh-goal-bar'].forEach((x) => assert(js.includes(x), 'card text missing: ' + x));
// Percent below 1% must not round to 0%.
const pctSrc = js.match(/function pctText\(p\) \{[\s\S]*?\n  \}/)[0];
const fmtSrc = js.match(/function fmt\(n, digits\) \{[\s\S]*?\n  \}/)[0];
const pctText = new Function(fmtSrc + pctSrc + 'return pctText;')();
assert(pctText(35 / 70500 * 100) === '0.05%' && pctText(0) === '0%' && pctText(5.26) === '5.3%' && pctText(42.4) === '42%' && pctText(null) === '–', 'pctText: ' + pctText(35 / 70500 * 100));
// 2.4.1: hero text + doors in one band, each door says what it is for; tabs live inside the data header; page clears the top bar.
assert((html.match(/class="ggh-entry-hint"/g) || []).length === 3 && html.includes('ggh-hero-sub') && html.includes('ใช้ได้ทั้ง Green Gain Hub, Agri-Risk Map และ Smart Agri'), '2.4.1 hero: sub line and door hints');
const scopeHtml = html.slice(html.indexOf('<section class="ggh-scope"'), html.indexOf('</section>', html.indexOf('<section class="ggh-scope"')));
assert(scopeHtml.includes('class="ggh-tabs"') && scopeHtml.includes('id="dashUpdated"') && scopeHtml.includes('id="resFyRange"'), '2.4.1 one data header: title, period, freshness, filters, tabs');
assert(html.includes('keepClearOfTopBar') && fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'dashboard.css'), 'utf8').includes('body.ggh-landing-on > nav > .container { max-width: 84rem; }'), '2.4.1 top bar width and offset');
// 2.4.2: one top card holds the ways in and the data header; the district filter's empty choice reads ทุกอำเภอ.
const topIdx = html.indexOf('<div class="ggh-topcard">');
assert(topIdx > 0 && topIdx < html.indexOf('<header class="ggh-hero">') && html.indexOf('<section class="ggh-scope"') < html.indexOf('</div>', html.indexOf('id="tab-market"')), '2.4.2 hero + data header in one card');
assert(html.includes('<option value="">ทุกอำเภอ</option>') && js.includes(`'<option value="">ทุกอำเภอ</option>'`) && !/'ทั้งจังหวัด'/.test(js), '2.4.2 ทุกอำเภอ instead of ทั้งจังหวัด');
const ssoSrc242 = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'sso-client.js'), 'utf8');
assert(ssoSrc242.includes("aud: 'GGH'") && ssoSrc242.includes('ticketFrom') && ssoSrc242.includes('function warm()') && html.includes('GGH_SSO.warm()'), '2.4.2 faster sign-in: ticket with the sign-in answer, warm-up');
console.log('PASS: 2.3.0–2.4.2 homepage layout, cards and percent format');
// 2.4.0: central identity (SSO) shared with Agri-Risk Map and Smart Agri.
const sso = fs.readFileSync(path.join(front, 'assets', 'sso-client.js'), 'utf8');
const staffAuth = fs.readFileSync(path.join(front, 'assets', 'staff-auth.js'), 'utf8');
new vm.Script(sso, { filename: 'frontend/assets/sso-client.js' });
const KPP = 'https://krit-pj.github.io/TH-Agri-Risk-Maps-Burning/js/kpp-id.js';
[html, admin].forEach((h, i) => assert(h.indexOf(KPP) > 0 && h.indexOf(KPP) < h.indexOf('assets/sso-client.js') && h.indexOf('assets/sso-client.js') < h.indexOf('assets/staff-auth.js'), 'kpp-id.js → sso-client.js → staff-auth.js order in ' + (i ? 'admin' : 'index')));
assert(/GGH_SSO\.market\(u\)/.test(html) && /fallback\(err\) \? legacy\(\)/.test(html) && /need_register/.test(html) && /GGH_SSO\.logout\(\)/.test(html) && /ssoAutoMarket/.test(html), 'homepage market sign-in through SSO with fallback, auto sign-in, logout everywhere');
assert(/ตัวตนกลาง/.test(html) && /Agri-Risk Map, KPP Smart Agri-Materials/.test(html), 'consent mentions the shared identity');
assert(/S\.staff\(p, call\)/.test(staffAuth) && /ssoAuto/.test(staffAuth) && /attach\(input\.phone/.test(staffAuth), 'officer sign-in/registration through SSO');
assert(/showSsoPrev/.test(adminJs) && /GGH_SSO\.logout\(\)/.test(adminJs) && /ssoAuto\(\)/.test(adminJs), 'officer pages: previous sign-in notice, logout everywhere, auto sign-in');
assert(/'ssoLoginServer'/.test(fs.readFileSync(path.join(front, 'assets', 'api-client.js'), 'utf8')), 'SSO session token kept by the RPC client');
console.log('PASS: 2.4.0 SSO wiring on the homepage and officer pages');
