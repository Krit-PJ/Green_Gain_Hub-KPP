const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'config.js'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(inlineScript, 'main inline script was not found');
new vm.Script(inlineScript[1], { filename: 'frontend/index.html' });
new vm.Script(config, { filename: 'frontend/assets/config.js' });
assert(
  config.includes('AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT/exec'),
  'deployment URL is missing or stale'
);
assert(config.includes("BUILD_VERSION: '1.7.0'"), 'frontend build version is missing or stale');
assert(config.includes("MINIMUM_API_VERSION: '1.3.1'"), 'minimum compatible API version is missing');

[
  'id="harvestFilterPanel"',
  'ช่วงเวลาเก็บเกี่ยวผลผลิต',
  'ระบบแสดงเฉพาะหมุดสีเขียวของแปลงเกษตรกร',
  'id="harvestPeriodFilter"',
  '<option value="ALL">ทั้งหมด</option>',
  'เมื่อเลือก “ทั้งหมด” ระบบจะแสดงเกษตรกรสถานะ Open ที่มีพิกัดทั้งหมด โดยไม่กรองวันเก็บเกี่ยว ปี หรือเดือน',
  'id="harvestMonthFrom"',
  'id="harvestMonthTo"',
  'function harvestDateParts',
  'function filterFarmersByHarvestPeriod',
  'function updateHarvestFilterSummary',
  'function matchingApiCompatibilityError',
  'function isVersionAtLeast',
  'function syncFarmerMaterial',
  "'ข้าวนาปี': 'ฟางข้าว'",
  "'ข้าวนาปรัง': 'ฟางข้าว'",
  "'อ้อยโรงงาน': 'ใบอ้อย'",
  "'มันสำปะหลัง': 'เหง้ามันสำปะหลัง'",
  'function contactPhone',
  'function navigationUrl',
  'function mapPointDescription',
  'function mobileActionLinks',
  'Array.isArray(data.ownPlots)',
  "const ownPlots = isFarmer ? (data.ownPlots || []) : []",
  "concat(ownPlots.map(item => ({ item, role: 'farmer', own: true })))",
  'ประเภท: แปลงของฉัน',
  'พิกัดแปลง',
  'พิกัดสถานที่รับซื้อ',
  'ปุ่มโทรและนำทางใช้ได้เฉพาะคู่ค้า',
  'Backend ต่ำกว่าเวอร์ชันขั้นต่ำ',
  'filterFarmersByHarvestPeriod(data.farmers)',
  "const partnerRole = isFarmer ? 'buyer' : 'farmer'",
  'const mapPoints = partnerTargets.map(item => ({ item, role: partnerRole, own: false }))',
  'Backend ยังไม่ได้จำกัดข้อมูลเฉพาะคู่ค้าฝั่งตรงข้าม',
  'mainMap.fitBounds(bounds',
  'กดหมุดเพื่อโทรติดต่อหรือเริ่มนำทาง',
  'href="tel:${phone}"',
  'https://www.google.com/maps/dir/?api=1&destination=',
  "getRoleMarkerIcon(currentUser?.role)"
].forEach(text => assert(html.includes(text), `missing component: ${text}`));

assert(!html.includes('marker-icon-red.png'), 'red marker must not remain');
assert(!html.includes('ต้องการรับซื้อภายในกี่วันหลังเก็บเกี่ยว'), 'retired buyer input is still visible');
assert(!html.includes('select[name="purchaseAfterHarvestDays"]'), 'retired buyer input is still submitted');
assert(!html.includes('ช่วงเวลารับซื้อ:'), 'retired buyer condition is still shown on partner cards');
assert(html.includes("const color = role === 'buyer' ? 'blue' : 'green';"), 'role marker colors are incorrect');
assert(html.includes('name="materialType" disabled'), 'farmer material field must be automatic');
assert(html.includes('ระบบกำหนดอัตโนมัติตามชนิดพืช'), 'automatic material explanation is missing');

const versionBody = html.match(/function isVersionAtLeast\(actual, minimum\) \{([\s\S]*?)\n    \}/);
assert(versionBody, 'isVersionAtLeast function was not found');
const versionPartsBody = html.match(/function versionParts\(value\) \{([\s\S]*?)\n    \}/);
assert(versionPartsBody, 'versionParts function was not found');
const versionParts = new Function('value', versionPartsBody[1]);
const isVersionAtLeast = new Function('versionParts', 'actual', 'minimum', versionBody[1]).bind(null, versionParts);
assert(isVersionAtLeast('1.3.1', '1.3.1'), 'equal compatible version was rejected');
assert(isVersionAtLeast('1.4.0', '1.3.1'), 'newer compatible version was rejected');
assert(!isVersionAtLeast('1.3.0', '1.3.1'), 'older incompatible version was accepted');
assert(!isVersionAtLeast('', '1.3.1'), 'missing API version was accepted');

const datePartsBody = html.match(/function harvestDateParts\(value\) \{([\s\S]*?)\n    \}/);
assert(datePartsBody, 'harvestDateParts function was not found');
const harvestDateParts = new Function('value', datePartsBody[1]);
assert(JSON.stringify(harvestDateParts('2026-07-15')) === JSON.stringify({ year: 2026, month: 7, day: 15 }), 'valid harvest date parsing failed');
assert(harvestDateParts('2026-02-30') === null, 'invalid calendar date must be rejected');
assert(harvestDateParts('15/07/2026') === null, 'non-ISO harvest date must be rejected');

const filterBody = html.match(/function filterFarmersByHarvestPeriod\(farmers\) \{([\s\S]*?)\n    \}/);
assert(filterBody, 'filterFarmersByHarvestPeriod function was not found');
const elements = {
  harvestPeriodFilter: { value: 'ALL' },
  harvestMonthFrom: { value: '1' },
  harvestMonthTo: { value: '12' }
};
const context = {
  currentUser: { role: 'buyer' },
  document: { getElementById: id => elements[id] || null },
  harvestDateParts
};
const runFilter = vm.runInNewContext(
  `(function(farmers) {${filterBody[1]}})`,
  context
);

const farmers = [
  { id: 'f1', harvestDate: '2026-01-15' },
  { id: 'f2', harvestDate: '2026-07-20' },
  { id: 'f3', harvestDate: '2026-11-20' },
  { id: 'f4', harvestDate: '2027-07-20' },
  { id: 'f5', harvestDate: '' }
];
assert(runFilter(farmers).length === 5, 'ALL must retain every farmer');
elements.harvestPeriodFilter.value = '2026';
elements.harvestMonthFrom.value = '4';
elements.harvestMonthTo.value = '9';
assert(runFilter(farmers).map(f => f.id).join(',') === 'f2', 'year and month-range filtering failed');
elements.harvestMonthFrom.value = '1';
elements.harvestMonthTo.value = '12';
assert(runFilter(farmers).map(f => f.id).join(',') === 'f1,f2,f3', 'full-year filtering failed');
context.currentUser.role = 'farmer';
assert(runFilter(farmers).length === 5, 'farmer view must not be filtered');

const phoneBody = html.match(/function contactPhone\(value\) \{([\s\S]*?)\n    \}/);
assert(phoneBody, 'contactPhone function was not found');
const contactPhone = new Function('value', phoneBody[1]);
assert(contactPhone('081-234-5678') === '0812345678', 'smartphone call number normalization failed');
assert(contactPhone('123') === '', 'invalid telephone must not create a tel link');

const navigationBody = html.match(/function navigationUrl\(lat, lng\) \{([\s\S]*?)\n    \}/);
assert(navigationBody, 'navigationUrl function was not found');
const navigationUrl = new Function('validCoordinates', 'lat', 'lng', navigationBody[1]).bind(null, (lat, lng) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
  Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180
);
const route = navigationUrl(16.48, 99.52);
assert(route.includes('/maps/dir/?api=1'), 'Google Maps directions endpoint is missing');
assert(route.includes('destination=16.48%2C99.52'), 'navigation coordinates were not encoded correctly');
assert(route.includes('travelmode=driving'), 'driving navigation mode is missing');
assert(route.includes('dir_action=navigate'), 'turn-by-turn navigation action is missing');

console.log('PASS: version compatibility, automatic crop/material mapping, own plots, partner-only actions, buyer overview, labels, harvest filter, and frontend syntax');
