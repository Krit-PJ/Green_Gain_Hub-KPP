const fs = require('fs');

class Range {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getValues() { return this.sheet.rows.slice(this.row - 1, this.row - 1 + this.numRows).map(r => r.slice(this.col - 1, this.col - 1 + this.numCols)); }
  getDisplayValues() { return this.getValues().map(r => r.map(v => String(v ?? ''))); }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { this.sheet.ensure(this.row, this.col); this.sheet.rows[this.row - 1][this.col - 1] = v; return this; }
  setValues(values) { values.forEach((r, i) => r.forEach((v, j) => this.setAt(i, j, v))); return this; }
  setAt(i, j, v) { this.sheet.ensure(this.row + i, this.col + j); this.sheet.rows[this.row - 1 + i][this.col - 1 + j] = v; }
  setFormula(v) { return this.setValue(v); }
}

class Sheet {
  constructor(rows) { this.rows = rows; }
  ensure(row, col) { while (this.rows.length < row) this.rows.push([]); while (this.rows[row - 1].length < col) this.rows[row - 1].push(''); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(...this.rows.map(r => r.length)); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
  appendRow(row) { this.rows.push(row.slice()); }
}

const headers = {
  users: ['Telephone','Password','Status','Name','System','Consent','Consent_Timestamp','Created_At','Updated_At'],
  farmers: ['ID','Timestamp','Name','Surname','Phone','Crop','Plant_Date','Havest_Date','Area (ไร่-งาน-ตร.ว.)','Lat','Lng','Stasus','Owner_Telephone','Material_Type','Material_Other','Map_Expire_Date','Map_Visible','Updated_At'],
  // Legacy A:P header: setup must append the new field safely at Q1.
  buyers: ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At'],
  Config: ['Parameter','Value','Unit','Description'],
};

const sheets = {
  users: new Sheet([headers.users, ['0812345678','','farmer','ผู้ทดสอบ',false,true,'','','']]),
  farmers: new Sheet([headers.farmers, ['f1',new Date(),'สมชาย','ทดสอบ','0812345678','ข้าวนาปี',new Date('2026-05-01'),new Date('2026-07-15'),'10 ไร่ 0 งาน 0 ตร.ว.',16.48,99.52,'Open','0812345678','ฟางข้าว','','','',new Date()]]),
  buyers: new Sheet([headers.buyers, ['b1',new Date(),'ผู้ซื้อ','ทดสอบ','0899999999',16.50,99.55,'ฟางข้าว','แห้ง',30,'10','Active','0899999999','ฟางข้าว','',new Date(),3]]),
  Config: new Sheet([headers.Config, ['visit_count',1,'ครั้ง','จำนวนครั้ง']]),
};

const cache = new Map();
global.SpreadsheetApp = { openById: () => ({ getSheetByName: name => sheets[name] || null }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.CacheService = { getScriptCache: () => ({ put: (k,v) => cache.set(k,v), get: k => cache.get(k) || null }) };
global.LockService = { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) };
global.Utilities = {
  getUuid: () => '11111111-2222-4333-8444-555555555555',
  formatDate: (d, tz, fmt) => {
    const x = new Date(d); const p = n => String(n).padStart(2,'0');
    const date = `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`;
    return fmt === 'yyyy-MM-dd' ? date : `${date} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
  }
};
global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased(){return this;}, everyDays(){return this;}, atHour(){return this;}, create(){} }), deleteTrigger(){} };

const code = fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const api = new Function(code + '; return { loginServer, getApiInfoServer, getUserProfileServer, saveDataServer, getMatchingDataServer, verifyDatabaseSchema, verifyLiveMatchingData, ensureBuyerHarvestDaysColumn_, restoreLegacyExpiredFarmers_, setupDailyTrigger, autoExpireFarmers };')();

function assert(value, message) { if (!value) throw new Error(message); }

assert(api.ensureBuyerHarvestDaysColumn_().startsWith('PASS'), 'buyers schema migration failed');
assert(sheets.buyers.rows[0][16] === 'Purchase_After_Harvest_Days', 'buyers Q1 header was not appended');
assert(api.verifyDatabaseSchema().startsWith('PASS'), 'schema verification failed');

const login = api.loginServer({ username: '0812345678' });
assert(login.status === 'success' && login.role === 'farmer', 'login mapping failed');

const session = { phone: '0812345678', role: 'farmer', name: 'ผู้ทดสอบ' };
const profile = api.getUserProfileServer(session);
assert(profile.farmers.length === 1 && profile.farmers[0].materialType === 'ฟางข้าว', 'farmer download mapping failed');

const saved = api.saveDataServer({
  role:'farmer', id:'f2', fname:'ใหม่', lname:'ทดสอบ', phone:'0812345678', crop:'มันสำปะหลัง',
  materialType:'เหง้ามันสำปะหลัง', materialOther:'', plantDate:'2026-05-01', harvestDate:'2026-08-01',
  area:'5 ไร่ 0 งาน 0 ตร.ว.', lat:16.40, lng:99.40
}, session);
assert(saved.status === 'success', 'farmer upload failed');
const newFarmer = sheets.farmers.rows.at(-1);
assert(newFarmer[12] === '0812345678' && newFarmer[13] === 'เหง้ามันสำปะหลัง' && newFarmer.length === 18, 'farmer column mapping failed');

const matches = api.getMatchingDataServer(session);
assert(matches.apiVersion === '1.3.1', 'matching API version is missing or stale');
assert(api.getApiInfoServer().apiVersion === '1.3.1', 'public API version check failed');
assert(api.getApiInfoServer().feature === 'OPPOSITE_ROLE_CONTACT_AND_NAVIGATION', 'map feature flag is missing or stale');
assert(matches.viewerRole === 'farmer' && matches.visibleRole === 'buyer', 'farmer visibility metadata is incorrect');
assert(matches.farmers.length === 0, 'farmer must not receive other farmer records');
assert(matches.buyers.length === 1 && matches.buyers[0].material === 'ฟางข้าว', 'buyer download mapping failed');
assert(matches.buyers[0].purchaseAfterHarvestDays === 3, 'buyer harvest-days download mapping failed');

// ALL must include old and future harvest dates when status is Open and coordinates exist.
sheets.farmers.rows.push(
  ['f-old',new Date(),'เกษตรกร','วันเก่า','0811111111','ข้าว',new Date('2024-01-01'),new Date('2024-06-01'),'2 ไร่',16.41,99.41,'Open','0811111111','ฟางข้าว','','','',''],
  ['f-no-coord',new Date(),'เกษตรกร','ไม่มีพิกัด','0822222222','ข้าว',new Date('2024-01-01'),new Date('2024-06-01'),'2 ไร่','','','Open','0822222222','ฟางข้าว','','','',''],
  ['f-deleted',new Date(),'เกษตรกร','ลบแล้ว','0833333333','ข้าว',new Date('2024-01-01'),new Date('2024-06-01'),'2 ไร่',16.43,99.43,'Deleted','0833333333','ฟางข้าว','','','','']
);
const buyerViewSession = { phone: '0899999999', role: 'buyer', name: 'ผู้ซื้อ ทดสอบ' };
const allMatches = api.getMatchingDataServer(buyerViewSession);
assert(allMatches.viewerRole === 'buyer' && allMatches.visibleRole === 'farmer', 'buyer visibility metadata is incorrect');
assert(allMatches.buyers.length === 0, 'buyer must not receive other buyer records');
assert(allMatches.farmers.some(f => f.id === 'f-old'), 'old harvest date must remain visible when Open with coordinates');
assert(!allMatches.farmers.some(f => f.id === 'f-no-coord'), 'farmer without coordinates must remain hidden');
assert(!allMatches.farmers.some(f => f.id === 'f-deleted'), 'non-Open farmer must remain hidden');
assert(api.verifyLiveMatchingData().includes('harvest expiry and Map_Visible are ignored'), 'live matching verification failed');

// setup migration restores only legacy Expired rows and never recreates the expiry trigger.
sheets.farmers.rows.push(
  ['f-expired',new Date(),'เกษตรกร','หมดอายุเดิม','0844444444','ข้าว',new Date('2024-01-01'),new Date('2024-06-01'),'2 ไร่',16.44,99.44,'Expired','0844444444','ฟางข้าว','','2024-06-11',false,'']
);
assert(api.restoreLegacyExpiredFarmers_().startsWith('PASS: restored 1'), 'legacy Expired row was not restored');
assert(sheets.farmers.rows.at(-1)[11] === 'Open', 'legacy Expired status must become Open');
assert(sheets.farmers.rows.at(-1)[15] === '', 'legacy expiry date must be cleared');
assert(api.setupDailyTrigger().includes('removed'), 'legacy trigger cleanup failed');
assert(api.autoExpireFarmers().includes('disabled'), 'legacy expiry entry point must not mutate records');

const buyerSession = { phone: '0899999999', role: 'buyer', name: 'ผู้ซื้อ ทดสอบ' };
const buyerSaved = api.saveDataServer({
  role:'buyer', id:'b2', fname:'โรงงาน', lname:'ตัวอย่าง', phone:'0899999999',
  materialType:'ใบอ้อย', materialOther:'', quality:'แห้ง', price:450, capacity:'20 ตัน/วัน',
  purchaseAfterHarvestDays:15, lat:16.55, lng:99.60
}, buyerSession);
assert(buyerSaved.status === 'success', 'buyer upload failed');
const newBuyer = sheets.buyers.rows.at(-1);
assert(newBuyer.length === 17 && newBuyer[16] === 15, 'buyer harvest-days column mapping failed');
const buyerProfile = api.getUserProfileServer(buyerSession);
assert(buyerProfile.buyers.at(-1).purchaseAfterHarvestDays === 15, 'buyer harvest-days profile mapping failed');

api.saveDataServer({
  role:'buyer', id:'b3', fname:'ผู้ซื้อเดิม', lname:'ไม่มีค่าใหม่', phone:'0899999999',
  materialType:'ฟางข้าว', quality:'แห้ง', price:300, capacity:'10 ตัน/วัน', lat:16.51, lng:99.51
}, buyerSession);
assert(sheets.buyers.rows.at(-1)[16] === 'ALL', 'legacy/default harvest-days value must be ALL');

api.saveDataServer({
  role:'buyer', id:'b4', fname:'ผู้ซื้อ', lname:'ทุกช่วงเวลา', phone:'0899999999',
  materialType:'ฟางข้าว', quality:'แห้ง', price:300, capacity:'10 ตัน/วัน',
  purchaseAfterHarvestDays:'ALL', lat:16.51, lng:99.51
}, buyerSession);
assert(sheets.buyers.rows.at(-1)[16] === 'ALL', 'ALL harvest-days value was not saved');
sheets.buyers.rows.at(-1)[16] = 0;
assert(api.getUserProfileServer(buyerSession).buyers.at(-1).purchaseAfterHarvestDays === 'ALL', 'legacy zero value must load as ALL');

let rejected16 = false;
try {
  api.saveDataServer({
    role:'buyer', id:'b5', fname:'ผู้ซื้อ', lname:'เกินกำหนด', phone:'0899999999',
    materialType:'ฟางข้าว', quality:'แห้ง', price:300, capacity:'10 ตัน/วัน',
    purchaseAfterHarvestDays:16, lat:16.51, lng:99.51
  }, buyerSession);
} catch (err) { rejected16 = true; }
assert(rejected16, 'harvest-days value 16 must be rejected');

console.log('PASS: GitHub ↔ Sheets upload/download schema mapping');
