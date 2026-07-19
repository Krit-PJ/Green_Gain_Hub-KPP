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
  buyers: ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At'],
  Config: ['Parameter','Value','Unit','Description'],
};

const sheets = {
  users: new Sheet([headers.users, ['0812345678','','farmer','ผู้ทดสอบ',false,true,'','','']]),
  farmers: new Sheet([headers.farmers, ['f1',new Date(),'สมชาย','ทดสอบ','0812345678','ข้าวนาปี',new Date('2026-05-01'),new Date('2026-07-15'),'10 ไร่ 0 งาน 0 ตร.ว.',16.48,99.52,'Open','0812345678','ฟางข้าว','','','',new Date()]]),
  buyers: new Sheet([headers.buyers, ['b1',new Date(),'ผู้ซื้อ','ทดสอบ','0899999999',16.50,99.55,'ฟางข้าว','แห้ง',30,'10','Active','0899999999','ฟางข้าว','',new Date()]]),
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
const api = new Function(code + '; return { loginServer, getUserProfileServer, saveDataServer, getMatchingDataServer, verifyDatabaseSchema, testMapExpiryRule };')();

function assert(value, message) { if (!value) throw new Error(message); }

assert(api.verifyDatabaseSchema().startsWith('PASS'), 'schema verification failed');
assert(api.testMapExpiryRule().startsWith('PASS'), 'expiry boundary failed');

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
assert(matches.buyers.length === 1 && matches.buyers[0].material === 'ฟางข้าว', 'buyer download mapping failed');

console.log('PASS: GitHub ↔ Sheets upload/download schema mapping');
