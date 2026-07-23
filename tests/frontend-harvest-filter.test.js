const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(inlineScript, 'main inline script was not found');
new vm.Script(inlineScript[1], { filename: 'frontend/index.html' });

[
  'id="harvestFilterPanel"',
  'ช่วงเวลาเก็บเกี่ยวผลผลิต',
  'ข้อมูลที่แสดงบนแผนที่เป็นข้อมูลของเกษตรกร (ผู้ขาย)',
  'id="harvestPeriodFilter"',
  '<option value="ALL">ทั้งหมด</option>',
  'เมื่อเลือก “ทั้งหมด” ระบบจะแสดงเกษตรกรสถานะ Open ที่มีพิกัดทั้งหมด โดยไม่กรองวันเก็บเกี่ยว ปี หรือเดือน',
  'id="harvestMonthFrom"',
  'id="harvestMonthTo"',
  'function harvestDateParts',
  'function filterFarmersByHarvestPeriod',
  'function updateHarvestFilterSummary',
  'filterFarmersByHarvestPeriod(data.farmers)',
  "getRoleMarkerIcon(isFarmer ? 'buyer' : 'farmer')",
  "getRoleMarkerIcon(currentUser?.role)"
].forEach(text => assert(html.includes(text), `missing component: ${text}`));

assert(!html.includes('marker-icon-red.png'), 'red marker must not remain');
assert(html.includes("const color = role === 'buyer' ? 'blue' : 'green';"), 'role marker colors are incorrect');

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

console.log('PASS: buyer harvest period, farmer data source, marker colors, and frontend syntax');
