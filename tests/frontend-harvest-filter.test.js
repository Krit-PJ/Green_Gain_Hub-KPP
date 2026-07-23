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
  'id="harvestViewMode"',
  '<option value="ALL">ทั้งหมด</option>',
  '<option value="YEAR">รายปี</option>',
  '<option value="MONTH">รายเดือน</option>',
  'id="harvestYearFilter"',
  'id="harvestMonthFilter"',
  'function harvestDateParts',
  'function filterFarmersByHarvestPeriod',
  'function updateHarvestFilterSummary',
  'filterFarmersByHarvestPeriod(data.farmers)'
].forEach(text => assert(html.includes(text), `missing harvest filter component: ${text}`));

const datePartsBody = html.match(/function harvestDateParts\(value\) \{([\s\S]*?)\n    \}/);
assert(datePartsBody, 'harvestDateParts function was not found');
const harvestDateParts = new Function('value', datePartsBody[1]);
assert(JSON.stringify(harvestDateParts('2026-07-15')) === JSON.stringify({ year: 2026, month: 7, day: 15 }), 'valid harvest date parsing failed');
assert(harvestDateParts('2026-02-30') === null, 'invalid calendar date must be rejected');
assert(harvestDateParts('15/07/2026') === null, 'non-ISO harvest date must be rejected');

const harvestHelpers = inlineScript[1].slice(
  inlineScript[1].indexOf('function harvestDateParts'),
  inlineScript[1].indexOf('function updateHarvestFilterSummary')
);
const elements = {
  harvestViewMode: { value: 'ALL' },
  harvestYearFilter: { value: '' },
  harvestMonthFilter: { value: '1' }
};
const context = {
  currentUser: { role: 'buyer' },
  document: { getElementById: id => elements[id] || null },
  Date,
  Number,
  String,
  Set
};
vm.createContext(context);
vm.runInContext(`${harvestHelpers}; this.runFilter = filterFarmersByHarvestPeriod;`, context);

const farmers = [
  { id: 'f1', harvestDate: '2026-01-15' },
  { id: 'f2', harvestDate: '2026-07-20' },
  { id: 'f3', harvestDate: '2027-07-20' },
  { id: 'f4', harvestDate: '' }
];
assert(context.runFilter(farmers).length === 4, 'ALL mode must retain every farmer');
elements.harvestViewMode.value = 'YEAR';
elements.harvestYearFilter.value = '2026';
assert(context.runFilter(farmers).map(f => f.id).join(',') === 'f1,f2', 'YEAR mode filtering failed');
elements.harvestViewMode.value = 'MONTH';
elements.harvestMonthFilter.value = '7';
assert(context.runFilter(farmers).map(f => f.id).join(',') === 'f2', 'MONTH mode filtering failed');
context.currentUser.role = 'farmer';
assert(context.runFilter(farmers).length === 4, 'farmer view must not be filtered');

console.log('PASS: buyer harvest year/month filter and frontend syntax');
