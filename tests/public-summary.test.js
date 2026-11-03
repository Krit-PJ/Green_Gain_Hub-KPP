const fs = require('fs');
const path = require('path');

function assert(value, message) { if (!value) throw new Error(message); }

function sheet(rows) {
  return {
    rows,
    getLastRow() { return this.rows.length; },
    getLastColumn() { return Math.max(...this.rows.map(r => r.length)); },
    getRange(row, col, numRows = 1, numCols = 1) {
      const self = this;
      return { getValues() { return self.rows.slice(row - 1, row - 1 + numRows).map(r => { const out = r.slice(col - 1, col - 1 + numCols); while (out.length < numCols) out.push(''); return out; }); } };
    }
  };
}

const farmersHead = ['ID','Timestamp','Name','Surname','Phone','Crop','Plant_Date','Havest_Date','Area (ไร่-งาน-ตร.ว.)','Lat','Lng','Stasus','Owner_Telephone','Material_Type','Material_Other','Map_Expire_Date','Map_Visible','Updated_At'];
const buyersHead = ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At','Purchase_After_Harvest_Days'];

const now = new Date(2026, 10, 3); // 3 Nov 2026
const inDays = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
const sheets = {
  farmers: sheet([farmersHead,
    // ขาณุวรลักษบุรี
    ['f1','', 'สมชาย','ลับ','0811111111','ข้าวนาปี','2026-08-01', inDays(10), '20 ไร่ 1 งาน 25 ตร.ว.', 16.073426, 99.891172, 'Open', '0811111111', 'ฟางข้าว', ''],
    ['f2','', 'สมชาย','ลับ','0811111111','ข้าวนาปรัง','2026-08-01', inDays(45), '10 ไร่ 0 งาน 0 ตร.ว.', 16.121852, 99.854822, 'Open', '0811111111', 'ฟางข้าว', ''],
    // เมืองกำแพงเพชร
    ['f3','', 'สมหญิง','ลับ','0822222222','มันสำปะหลัง','2026-01-01','2026-03-24', '30 ไร่ 2 งาน 0 ตร.ว.', 16.477386, 99.513697, 'Open', '0822222222', 'เหง้ามันสำปะหลัง', ''],
    // legacy row without owner, phone stored as number
    ['f4','', 'เก่า','ลับ', 869270224,'ข้าวนาปี','2026-05-30','2026-08-31', '2 ไร่ 3 งาน 0 ตร.ว.', 16.528924, 99.677528, 'Open', '', 'ฟางข้าว', ''],
    // no coordinates → OTHER bucket
    ['f5','', 'ไม่มี','พิกัด','0833333333','ข้าวนาปี','','', '5', '', '', 'Open', '0833333333', 'ฟางข้าว', ''],
    // excluded: deleted
    ['f6','', 'ลบ','แล้ว','0844444444','ข้าวนาปี','','', '100 ไร่', 16.07, 99.89, 'Deleted', '0844444444', 'ฟางข้าว', '']
  ]),
  buyers: sheet([buyersHead,
    ['b1','', 'ศูนย์','ลับ','0625419987', 16.075923, 99.885041, 'ฟางข้าว','ฟาง 2-5 แดด', 30, '45', 'Active', '0625419987', 'ฟางข้าว', ''],
    ['b2','', 'ศูนย์','ลับ','0829163605', 16.121696, 99.943756, 'ฟางข้าว','ฟาง 2-5 แดด', 40, '15 ตัน/วัน', 'Active', '0829163605', 'ฟางข้าว', ''],
    ['b3','', 'ปิด','แล้ว','0899999999', 16.1, 99.8, 'ฟางข้าว','', 999, '999', 'Deleted', '0899999999', 'ฟางข้าว', '']
  ]),
  Research_Refs: sheet([['ID','Type','SubType','BioRate','PriceMin','PriceMax','PriceAvg','Source'], ['r1','ฟางข้าว','', 0.5, '', '', '', 'test value']]),
  Goals: sheet([['ID','Icon','Title','Description','SortOrder','Active'], ['g1','🌾','ลดการเผา','ตัวอย่าง',2,true], ['g2','x','ปิดอยู่','',1,false]]),
  Config: sheet([['Parameter','Value','Unit','Description']])
};

const cache = new Map();
let props = {};
global.SpreadsheetApp = { openById: () => ({ getSheetByName: name => sheets[name] || null }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null }) };
global.CacheService = { getScriptCache: () => ({ put: (k, v) => cache.set(k, v), get: k => cache.get(k) || null, remove: k => cache.delete(k) }) };
global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
global.Utilities = { formatDate: (d, tz, fmt) => { const x = new Date(d); const p = n => String(n).padStart(2, '0'); return fmt === 'yyyy-MM' ? `${x.getFullYear()}-${p(x.getMonth() + 1)}` : `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; } };
let lastOutput = null;
global.ContentService = {
  MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
  createTextOutput: body => (lastOutput = { body, setMimeType(m) { this.mime = m; return this; } })
};

const root = path.join(__dirname, '..', 'apps-script');
const districts = fs.readFileSync(path.join(root, 'Districts.gs'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
let fetched = [];
let upstream = 'ok';
const smartBodies = {
  summary: { ok: true, api_version: '1', endpoint: 'summary', generated_at: '2026-11-03 07:00:00', data: {
    round: { round: 2, label: 'ครั้งที่ 2', start: '2026-10-27', end: '2026-11-02', due: '2026-11-03' }, districts_total: 11,
    reported: { count: 3, districts: ['D01', 'D04', 'D05'] }, status_counts: { accepted: 1, submitted: 2, draft: 1, returned: 0, none: 7 },
    items: [{ id: 'R31', code: '2.2', label: 'ไถกลบตอซัง/การใช้สารย่อยสลาย', unit: 'ไร่', week: 120, cumulative: 950, districts_reporting_yes: 3,
      by_district: { D04: { week: 100, cumulative: 800 } } }],
    other_activities: [] } },
  districts: { ok: true, data: { round: {}, districts: [
    { code: 'D04', name: 'ขาณุวรลักษบุรี', amp_code: '6204', status: 'accepted', counted: true, late: false, items: { R31: { week: 100, cumulative: 800, unit: 'ไร่' } } },
    { code: 'D02', name: 'ไทรงาม', amp_code: '6202', status: 'none', counted: false, late: false, items: { R31: { week: null, cumulative: null, unit: 'ไร่' } } }] } },
  timeseries: { ok: true, data: { scope: 'province', items: [], series: [
    { round: 1, label: 'ครั้งที่ 1', start: '2026-10-20', end: '2026-10-26', reported: 2, values: { R31: { week: 830, cumulative: 830 } } },
    { round: 2, label: 'ครั้งที่ 2', start: '2026-10-27', end: '2026-11-02', reported: 3, values: { R31: { week: 120, cumulative: 950 } } }] } },
  meta: { ok: true, data: { site: 'KPP Smart Agri-Materials', office: 'สำนักงานเกษตรจังหวัดกำแพงเพชร', title: 'แบบรายงาน', season: '2569 - 2570' } }
};
global.UrlFetchApp = { fetchAll: reqs => reqs.map(r => {
  fetched.push(r.url);
  const ep = r.url.match(/endpoint=(\w+)/)[1];
  if (upstream === 'down') return { getResponseCode: () => 500, getContentText: () => 'err' };
  if (upstream === 'badkey') return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: false, error: 'API Key ไม่ถูกต้องหรือถูกยกเลิกแล้ว', code: 'invalid_key' }) };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(smartBodies[ep]) };
}) };
const api = new Function(districts + '\n' + code + '; return { doGet, buildPublicSummary_, parseAreaRai_, leadingNumber_, districtList_, districtForPoint_, getApiInfoServer, getSmartAgriReports_, verifySmartAgriConnection };')();

// Helpers
assert(Math.abs(api.parseAreaRai_('20 ไร่ 1 งาน 25 ตร.ว.') - 20.3125) < 1e-9, 'area parsing failed');
assert(api.parseAreaRai_('5') === 5 && api.parseAreaRai_('') === 0, 'bare-number area parsing failed');
assert(api.leadingNumber_('15 ตัน/วัน') === 15 && api.leadingNumber_('') === 0, 'capacity parsing failed');
const list = api.districtList_();
assert(list.length === 11, 'Kamphaeng Phet must have 11 districts');
assert(api.districtForPoint_(16.073426, 99.891172, list).name === 'ขาณุวรลักษบุรี', 'Khanu point mapped to the wrong district');
assert(api.districtForPoint_(16.477386, 99.513697, list).name === 'เมืองกำแพงเพชร', 'Mueang point mapped to the wrong district');
assert(api.districtForPoint_(13.75, 100.5, list) === null, 'Bangkok must be outside the province');

// Summary content
const s = api.buildPublicSummary_(now);
assert(s.totals.farmerPlots === 5, 'Open plots count is wrong: ' + s.totals.farmerPlots);
assert(s.totals.farmers === 4, 'unique farmer count must use Owner_Telephone with Phone fallback');
assert(s.totals.plotsWithCoordinates === 4, 'plots with coordinates is wrong');
assert(Math.abs(s.totals.areaRai - (20.3125 + 10 + 30.5 + 2.75 + 5)) < 0.01, 'total area is wrong');
assert(s.totals.buyers === 2 && s.totals.capacityTonPerDay === 60, 'Active buyer totals are wrong');
assert(s.totals.avgBuyerPriceBahtPerRai === 35, 'average buyer price is wrong');
assert(s.upcomingHarvest.days30.plots === 1 && s.upcomingHarvest.days60.plots === 2, 'upcoming harvest windows are wrong');
const khanu = s.byDistrict.find(d => d.name === 'ขาณุวรลักษบุรี');
assert(khanu.plots === 2 && khanu.farmers === 1 && khanu.buyers === 2, 'Khanu district aggregation is wrong');
assert(s.byDistrict.find(d => d.code === 'OTHER').plots === 1, 'plot without coordinates must go to OTHER');
const straw = s.byMaterial.find(m => m.material === 'ฟางข้าว');
assert(straw.bioRateTonPerRai === 0.5 && straw.residueTon === Math.round((20.3125 + 10 + 2.75 + 5) * 0.5 * 10) / 10, 'BioRate residue estimate is wrong');
assert(s.byMaterial.find(m => m.material === 'เหง้ามันสำปะหลัง').residueTon === null, 'material without BioRate must not be estimated');
assert(s.harvestByMonth.length === 13 && s.harvestByMonth[6].isCurrent && s.harvestByMonth[6].month === '2026-11', 'harvest month window is wrong');
assert(s.goals.length === 1 && s.goals[0].title === 'ลดการเผา', 'only Active goals must be returned');

// Privacy: no names, phones, IDs or raw coordinates may leak.
const json = JSON.stringify(s);
['สมชาย', 'สมหญิง', '0811111111', '869270224', '0625419987', 'f1', 'b1', '16.073426', '99.891172', '16.075923'].forEach(secret => {
  assert(!json.includes(secret), 'public summary leaked: ' + secret);
});

// HTTP routing: JSON, JSONP, health, key gate, and RPC untouched.
api.doGet({ parameter: { api: 'v1', endpoint: 'summary', key: 'YOUR_KEY' } });
let out = JSON.parse(lastOutput.body);
assert(out.ok && out.api === 'v1' && out.apiVersion === '1.5.0' && out.data.totals.farmerPlots === 5 && lastOutput.mime === 'json', 'JSON summary route failed');
api.doGet({ parameter: { api: 'v1', endpoint: 'summary', callback: 'cb_1' } });
assert(lastOutput.body.startsWith('cb_1(') && lastOutput.mime === 'js', 'JSONP summary route failed');
api.doGet({ parameter: { api: 'v1', endpoint: 'health' } });
assert(JSON.parse(lastOutput.body).feature === 'PUBLIC_SUMMARY_DASHBOARD', 'health route failed');
api.doGet({ parameter: { api: 'v1', endpoint: 'nope' } });
assert(JSON.parse(lastOutput.body).ok === false, 'unknown endpoint must fail');
props = { SUMMARY_API_KEY: 'secret-1' };
api.doGet({ parameter: { api: 'v1', endpoint: 'summary', key: 'wrong' } });
assert(JSON.parse(lastOutput.body).ok === false, 'configured key must be enforced');
api.doGet({ parameter: { api: 'v1', endpoint: 'summary', key: 'secret-1' } });
assert(JSON.parse(lastOutput.body).ok === true, 'matching key must be accepted');
props = {};
api.doGet({ parameter: { action: 'rpc', method: 'getApiInfoServer', args: '[]' } });
assert(JSON.parse(lastOutput.body).result.apiVersion === '1.5.0', 'existing RPC route must keep working');

// Without Districts.gs the summary still works (everything falls into OTHER).
const apiNoDistricts = new Function(code + '; return { buildPublicSummary_ };')();
const s2 = apiNoDistricts.buildPublicSummary_(now);
assert(s2.totals.farmerPlots === 5 && s2.byDistrict.length === 1 && s2.byDistrict[0].code === 'OTHER', 'summary must degrade gracefully without Districts.gs');

// Smart Agri-Materials proxy
cache.clear(); props = {};
let rep = api.getSmartAgriReports_(true);
assert(rep.ok === false && rep.configured === false && fetched.length === 0, 'proxy must not call upstream without SMART_AGRI_API_KEY');
assert(api.verifySmartAgriConnection().startsWith('INFO:'), 'unconfigured proxy must report INFO, not FAIL');
props = { SMART_AGRI_API_KEY: 'kpp_testkey123' };
cache.clear();
rep = api.getSmartAgriReports_(true);
assert(rep.ok && rep.round.round === 2 && rep.reportedCount === 3 && rep.districtsTotal === 11, 'proxy normalization of summary failed');
assert(rep.items[0].id === 'R31' && rep.items[0].cumulative === 950 && rep.items[0].unit === 'ไร่', 'proxy items mapping failed');
const kh = rep.byDistrict.find(d => d.code === '6204');
assert(kh && kh.status === 'accepted' && kh.items.R31.cumulative === 800, 'proxy must key districts by amp_code');
assert(rep.byDistrict.find(d => d.code === '6202').items.R31.cumulative === null, 'missing values must stay null, not 0');
assert(rep.series.length === 2 && rep.series[1].values.R31.cumulative === 950, 'proxy timeseries mapping failed');
assert(fetched.length === 4 && fetched.every(u => u.includes('key=kpp_testkey123') && u.includes('items=agri') && u.startsWith('https://script.google.com/macros/s/AKfycbxoo4')), 'proxy must call the Smart Agri deployment with key server-side');
const before = fetched.length;
api.getSmartAgriReports_(false);
assert(fetched.length === before, 'proxy result must be cached');
api.doGet({ parameter: { api: 'v1', endpoint: 'summary' } });
out = JSON.parse(lastOutput.body);
assert(out.ok && out.data.reports.ok && out.data.reports.items[0].id === 'R31', 'summary must include Smart Agri reports');
assert(!lastOutput.body.includes('kpp_testkey123'), 'API key must never be sent to the browser');
cache.clear(); upstream = 'badkey';
rep = api.getSmartAgriReports_(true);
assert(rep.ok === false && rep.configured === true && /API Key/.test(rep.error), 'upstream API errors must surface as ok:false');
cache.clear(); upstream = 'down';
api.doGet({ parameter: { api: 'v1', endpoint: 'summary' } });
out = JSON.parse(lastOutput.body);
assert(out.ok && out.data.totals.farmerPlots === 5 && out.data.reports.ok === false, 'upstream outage must not break the GGH summary');
assert(api.verifySmartAgriConnection().startsWith('FAIL:'), 'configured but failing proxy must report FAIL');
upstream = 'ok'; props = {};

console.log('PASS: Smart Agri-Materials proxy — key stays server-side, normalization, cache, graceful failure');
console.log('PASS: public summary v1 — aggregates, district mapping, BioRate, privacy, routing and key gate');
