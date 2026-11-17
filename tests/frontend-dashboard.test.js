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
['id="dashMap"', 'id="dashKpis"', 'id="dashHarvest"', 'id="dashMaterials"', 'id="dashTable"', 'id="dashDistrict"', 'id="dashSearch"',
  'role="tablist"', 'data-tab="overview"', 'data-tab="crops"', 'data-tab="reports"', 'data-tab="market"', 'id="dashCropMonths"', 'id="dashCropStack"', 'id="dashAsOf"', 'href="admin.html#admin"'].forEach(s => assert(html.includes(s), 'dashboard markup missing: ' + s));
assert(html.includes('assets/dashboard.js?v=2.2.1') && html.includes('assets/dashboard.css?v=2.2.1'), 'dashboard assets are not linked');
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
assert(html.includes('ระบบศูนย์กลางเชื่อมโยงการจัดการเศษวัสดุทางการเกษตร') && html.includes('การลดปริมาณก๊าซเรือนกระจกในภาคการเกษตร'), 'new system name and lede missing');
assert(/data-tab="overview">การจัดการเศษวัสดุ</.test(html) && /data-tab="crops">สถานการณ์การเพาะปลูก</.test(html), 'tab names must be renamed');
assert(html.includes('id="resCropIcons"') && html.includes('id="resMethods"') && html.includes('id="resProgress"') && html.includes('id="resFy"'), 'residue tab markup missing');
assert(!/ggh-cropmonths" data-tabs="overview/.test(html), 'old overview cards must be removed from the residue tab');
assert(admin.includes('id="recForm"') && admin.includes('capture="environment"') && admin.includes('name="confirmed"') && admin.includes('id="recGpsBtn"'), 'recording form missing');
assert(admin.includes('value="mini"') && admin.includes('id="adminDistrict"') && admin.includes('id="reportTypes"') && !admin.includes('id="reportAll"'), 'roles / report types (no select-all) missing');
const dash = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'dashboard.js'), 'utf8');
assert(dash.includes("endpoint: 'residue'") && dash.includes('resGhg') && dash.includes('data-province'), 'dashboard must load residue data');
// 2.1.0: top bar name, no hero title, Green Gain Hub brand in the sign-in card, officer sign-in/registration, value.
// 2.2.0: short name on top, full official name in the footer; entry doors; sign-in card for farmers and buyers.
assert(/ggh-topbar-title[^>]*>Green Gain Hub <span data-province>/.test(html) && html.includes('ggh-topbar-sub') && !html.includes('class="ggh-title"'), 'top bar title / hero title');
assert(/<footer[\s\S]*ระบบศูนย์กลางเชื่อมโยงการจัดการเศษวัสดุทางการเกษตร/.test(html), 'full official name in the footer');
assert(/ggh-dialog-kicker">สำหรับเกษตรกรและผู้รับซื้อ</.test(html) && html.includes('STAFF_ACCOUNT') && html.includes('MARKET_ACCOUNT') && html.includes('data-to-staff') && html.includes('data-to-hub'), 'wrong-box numbers switch to the other popup');
assert(js.includes('renderDistrictRanking'), 'side panel ranks districts when nothing is selected');
assert(['data-role="farmer"', 'data-role="buyer"', 'data-door="staff"'].every((x) => html.includes(x)) && html.indexOf('ggh-doors') < html.indexOf('ggh-tabs"'), 'entry doors before the province data');
assert(!/tCO₂e|tCO2e/.test(html + dash) && dash.includes('ตันคาร์บอนไดออกไซด์เทียบเท่า'), 'Thai GHG unit on the homepage');
assert(dash.includes("endpoint: 'balance'") && html.includes('id="resBalance"'), 'residue balance on the homepage');
assert(admin.includes('id="staffLoginForm"') && admin.includes('id="staffRegForm"') && admin.includes('id="regProvinces"') && admin.includes('id="regGroup"'), 'officer sign-in / registration');
assert(admin.includes('name="priceBahtKg"') && admin.includes('name="useGlobalPrice"') && admin.includes('id="priceForm"') && admin.includes('name="countValue"') && dash.includes('มูลค่าเศษวัสดุ'), 'value settings and display');
// 2.2.0 admin: task menus, overview, buyer link, print rules.
const adminCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'admin.css'), 'utf8');
assert(/admin: \[\{ key: 'record'[\s\S]*?\{ key: 'account'/.test(adminJs) && (adminJs.match(/\{ key: '(overview|data|reports|users|settings)', label/g) || []).length === 5, 'Admin 4 items, Mini/Super 5 groups');
assert(admin.includes('data-panel="overview"') && admin.includes('id="recBuyer"') && admin.includes('name="soldTonnes"') && adminJs.includes('residueBalanceServer'), 'overview and marketplace link');
assert(adminCss.includes('@page') === false && adminJs.includes('@page wide') && adminCss.includes('page: wide') && adminCss.includes('.print-hide') && adminCss.includes('display: table-header-group'), 'print: named landscape pages, excel-only columns, repeated headers');
assert(!/tCO₂e|tCO2e/.test(admin + adminJs), 'Thai GHG unit on the admin page');

