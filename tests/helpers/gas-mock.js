// Minimal Google Apps Script runtime for running apps-script/*.gs in Node.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  ensure(r, c) { while (this.rows.length < r) this.rows.push([]); while (this.rows[r - 1].length < c) this.rows[r - 1].push(''); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length ? Math.max(...this.rows.map((r) => r.length)) : 0; }
  setFrozenRows() {}
  appendRow(r) { this.rows.push(r.slice()); }
  getRange(row, col, nr = 1, nc = 1) {
    if (typeof row === 'string') return { setNumberFormat() { return this; } };
    const sh = this;
    return {
      getValue() { return ((sh.rows[row - 1] || [])[col - 1] ?? ''); },
      getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sh.rows[row - 1 + i] || [])[col - 1 + j] ?? ''))); },
      getDisplayValues() { return this.getValues().map((r) => r.map((v) => String(v ?? ''))); },
      setValues(v) { v.forEach((r, i) => r.forEach((x, j) => { sh.ensure(row + i, col + j); sh.rows[row - 1 + i][col - 1 + j] = x; })); return this; },
      setValue(x) { sh.ensure(row, col); sh.rows[row - 1][col - 1] = x; return this; },
      setNumberFormat() { return this; },
      setFormula(x) { return this.setValue(x); }
    };
  }
}

const HEADERS = {
  users: ['Telephone', 'Password', 'Status', 'Name', 'System', 'Consent', 'Consent_Timestamp', 'Created_At', 'Updated_At'],
  farmers: ['ID', 'Timestamp', 'Name', 'Surname', 'Phone', 'Crop', 'Plant_Date', 'Havest_Date', 'Area (ไร่-งาน-ตร.ว.)', 'Lat', 'Lng', 'Stasus', 'Owner_Telephone', 'Material_Type', 'Material_Other', 'Map_Expire_Date', 'Map_Visible', 'Updated_At'],
  buyers: ['ID', 'Timestamp', 'Name', 'Surname', 'Phone', 'Lat', 'Lng', 'Material', 'Quality', 'Price', 'Capacity', 'Status', 'Owner_Telephone', 'Material_Type', 'Material_Other', 'Updated_At', 'Purchase_After_Harvest_Days'],
  Config: ['Parameter', 'Value', 'Unit', 'Description']
};

/** Installs globals and loads the .gs files. Returns { api, sheets, props, cache, out() }. */
function load(options) {
  options = options || {};
  const sheets = Object.assign({
    users: new Sheet('users', [HEADERS.users]),
    farmers: new Sheet('farmers', [HEADERS.farmers]),
    buyers: new Sheet('buyers', [HEADERS.buyers]),
    Config: new Sheet('Config', [HEADERS.Config]),
    Research_Refs: new Sheet('Research_Refs', [['ID', 'Type', 'SubType', 'BioRate', 'PriceMin', 'PriceMax', 'PriceAvg', 'Source']])
  }, options.sheets || {});
  const props = Object.assign({}, options.props || {});
  const cache = new Map();
  let last = null;
  const signed = (b) => [...b].map((x) => (x > 127 ? x - 256 : x));
  global.SpreadsheetApp = { openById: () => ({ getId: () => 'SS', getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n)) }) };
  // Drive: one parent folder holding the database, folders and files kept in memory.
  const drive = { files: {}, folders: {}, n: 0 };
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const makeFolder = (name) => {
    const id = 'fo' + (++drive.n);
    const f = { id, name, children: [], getId: () => id, getName: () => name,
      getFoldersByName: (n) => iter(f.children.filter((c) => c.name === n)),
      createFolder: (n) => { const c = makeFolder(n); f.children.push(c); return c; },
      createFile: (blob) => { const fid = 'fi' + (++drive.n); drive.files[fid] = { id: fid, blob, trashed: false, folder: id }; return { getId: () => fid }; } };
    drive.folders[id] = f; return f;
  };
  const root = makeFolder('7. Green Gain Hub');
  global.DriveApp = {
    getFileById: (id) => {
      if (id === 'SS') return { getParents: () => iter([root]) };
      const f = drive.files[id]; if (!f) throw new Error('No item with the given ID could be found');
      return { getBlob: () => ({ getContentType: () => f.blob.mime, getBytes: () => f.blob.bytes }), setTrashed: (t) => { f.trashed = !!t; } };
    },
    getFolderById: (id) => { if (!drive.folders[id]) throw new Error('No folder'); return drive.folders[id]; },
    getRootFolder: () => root
  };
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) };
  global.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k), removeAll: (ks) => ks.forEach((k) => cache.delete(k)) }) };
  global.LockService = { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) };
  global.Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, s) => signed(crypto.createHash(a).update(String(s), 'utf8').digest()),
    base64EncodeWebSafe: (b) => Buffer.from(b.map((x) => x & 255)).toString('base64url'),
    getUuid: () => crypto.randomUUID(),
    base64Decode: (s) => [...Buffer.from(s, 'base64')].map((x) => (x > 127 ? x - 256 : x)),
    base64Encode: (b) => Buffer.from(b.map((x) => x & 255)).toString('base64'),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    formatDate: (d, tz, f) => {
      const x = new Date(d), p = (n) => String(n).padStart(2, '0');
      if (f === 'yyyyMMddHHmmss') return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`;
      if (f === 'yyyy-MM') return `${x.getFullYear()}-${p(x.getMonth() + 1)}`;
      if (f === 'yyyyMMddHHmmss') return '';
      const date = `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
      return f === 'yyyy-MM-dd' ? date : `${date} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
    }
  };
  global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
  global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {} };
  global.ContentService = { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (b) => (last = { body: b, setMimeType(m) { this.mime = m; return this; } }) };
  global.UrlFetchApp = options.urlFetch || { fetchAll: () => { throw new Error('no network in tests'); } };
  const dir = path.join(__dirname, '..', '..', 'apps-script');
  const files = options.files || ['Districts.gs', 'Code.gs', 'Admin.gs', 'Crops.gs', 'Counter.gs', 'Reports.gs', 'Ghg.gs', 'Residue.gs', 'Staff.gs', 'Balance.gs', 'Sso.gs', 'Market.gs'];
  const src = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const names = options.expose || [];
  const api = new Function(src + '; return { doGet, doPost, setupSystem' + names.map((n) => ', ' + n).join('') + ' };')();
  return {
    api, sheets, props, cache, Sheet, drive,
    out: () => last,
    post(method, args, token) { api.doPost({ postData: { contents: JSON.stringify({ method, args: args || [], token }) } }); return JSON.parse(last.body); },
    get(params) { api.doGet({ parameter: params }); return last.mime === 'json' ? JSON.parse(last.body) : last.body; }
  };
}

module.exports = { load, Sheet, HEADERS };
