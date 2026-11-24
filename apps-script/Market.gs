/**
 * Green Gain Hub 2.5.0 — public matching map (หน้าแรกสำหรับเกษตรกรและผู้รับซื้อ)
 *
 * Shows where agricultural residue is offered and where it is bought, per material, so a farmer can see
 * "who buys my straw near me" and a buyer can see "where is the straw". Public = aggregate only:
 *   - points are grouped into a grid of MARKET_GRID_DEG degrees (about 5.5 km); the cell centre is published,
 *     never the real coordinate, name or phone
 *   - exact pins, names and phone numbers stay in the signed-in market (getMatchingDataServer, unchanged)
 * Material groups follow Balance.gs (rice / sugarcane / maize / cassava / other) so the map, the balance
 * table and the GHG settings speak the same language.
 *
 * 2.8.0: a plot leaves the market N days after its harvest date (Config hide_after_harvest_days, default 20, 0 = off;
 * set by officers in ABM). Plots without a harvest date are not shown. The farmer can press "ยังมีวัสดุอยู่" to show the
 * plot again for N days (date kept in farmers!P Map_Expire_Date). Nothing is deleted or re-labelled — only not shown.
 * The sheet rows stay "Open", so changing N (or turning the rule off) takes effect at once.
 *
 * 3.0.0: one province per request (?province=<code>, default กำแพงเพชร). Rows are counted by the province / district the
 * server stored from their pin (Geo.gs). The payload adds: byDistrict (every district of the province with area, farmers
 * — distinct sellers —, tonnes, buyers), totals.farmers, and provinces (activity per province, for the province picker).
 *
 * 2.7.0: each material also says WHEN the residue is available (sell.timing: now / within 30 days / 31–90 days /
 * later, by harvest date), and the payload lists the province's districts so the page can show all 11, empty ones too.
 */
const MARKET_GRID_DEG = 0.05;
const MARKET_CACHE_SECONDS = 300;
const MARKET_READY_DAYS = 15;   // harvested, or harvesting within 15 days = "พร้อมขาย"
// 2.7.0 harvest-date buckets: now = harvested (or no date) · d30 = 1–30 days · d90 = 31–90 days · later = beyond 90 days
const MARKET_TIMING = ['now', 'd30', 'd90', 'later'];
function marketTimingOf_(days) { return days === null || days <= 0 ? 'now' : days <= 30 ? 'd30' : days <= 90 ? 'd90' : 'later'; }
function marketEmptyTiming_() { const t = {}; MARKET_TIMING.forEach(function (k) { t[k] = { plots: 0, areaRai: 0, ton: null }; }); return t; }
const MARKET_GROUPS = [
  { key: 'rice', label: 'ฟางข้าว' },
  { key: 'sugarcane', label: 'ใบและยอดอ้อย' },
  { key: 'maize', label: 'ซังและต้นข้าวโพด' },
  { key: 'cassava', label: 'เหง้ามันสำปะหลัง' },
  { key: 'other', label: 'วัสดุอื่น' }
];

/* ---------------- 2.8.0: how long a plot stays on the market after harvest ---------------- */
const MARKET_CACHE_PREFIX = 'market:v2:';
const HIDE_DAYS_PARAM = 'hide_after_harvest_days';
const HIDE_START_PARAM = 'hide_after_harvest_start';
const HIDE_DAYS_DEFAULT = 20;
const HIDE_DAYS_MAX = 365;

/** Writes one Config row (Parameter, Value, Unit, Description), adding it when missing. */
function settingWrite_(key, value, unit, description) {
  const sh = sheet_('settings');
  const last = sh.getLastRow();
  const names = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  const i = names.indexOf(key);
  const row = [key, value, unit || '', description || ''];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 4).setValues([row]); else sh.appendRow(row);
}

function hideDaysValid_(v) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || Math.floor(n) !== n || n < 0 || n > HIDE_DAYS_MAX) {
    throw new Error('จำนวนวันต้องเป็นจำนวนเต็ม 0–' + HIDE_DAYS_MAX + ' (0 = ไม่ซ่อน)');
  }
  return n;
}

/** { days, start } — the first call after 2.8.0 turns the rule on with 20 days, counted from today for plots already listed. */
function marketHideRule_() {
  let days = setting_(HIDE_DAYS_PARAM, null);
  let start = setting_(HIDE_START_PARAM, null);
  if (days === null || days === '') {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        days = setting_(HIDE_DAYS_PARAM, null);
        start = setting_(HIDE_START_PARAM, null);
        if (days === null || days === '') {
          days = HIDE_DAYS_DEFAULT;
          start = dateInput_(new Date());
          hideRuleWrite_(days, start);
        }
      } finally { lock.releaseLock(); }
    } else {
      days = HIDE_DAYS_DEFAULT;
    }
  }
  let n = Number(days);
  if (!isFinite(n) || n < 0) n = HIDE_DAYS_DEFAULT;
  return { days: Math.min(Math.floor(n), HIDE_DAYS_MAX), start: toDate_(start) };
}

function hideRuleWrite_(days, start) {
  settingWrite_(HIDE_DAYS_PARAM, days, 'วัน', 'ซ่อนแปลงจากตลาดเมื่อเลยวันเก็บเกี่ยวกี่วัน (0 = ไม่ซ่อน) — ตั้งค่าที่ ABM');
  settingWrite_(HIDE_START_PARAM, start, 'วันที่', 'วันที่เริ่มใช้กฎ: แปลงที่ประกาศไว้ก่อนหน้า นับวันจากวันนี้แทนวันเก็บเกี่ยว');
}

/** Is this farmer row shown on the market today? { listed, until (Date|null), reason: ''|'no_harvest'|'after_harvest' } */
function farmerListing_(r, rule, today) {
  if (!rule.days) return { listed: true, until: null, reason: '' };
  const harvest = toDate_(r[7]);
  if (!harvest) return { listed: false, until: null, reason: 'no_harvest' };
  const DAY = 86400000;
  let until = startOfDay_(harvest).getTime() + rule.days * DAY;
  if (rule.start) until = Math.max(until, startOfDay_(rule.start).getTime() + rule.days * DAY);
  const renewed = toDate_(r[15]);   // P Map_Expire_Date = shown until (set by "ยังมีวัสดุอยู่")
  if (renewed) until = Math.max(until, startOfDay_(renewed).getTime());
  const listed = startOfDay_(today).getTime() <= until;
  return { listed: listed, until: new Date(until), reason: listed ? '' : 'after_harvest' };
}

function marketProvinceCode_(p) {
  const code = String((p && p.province) || '').replace(/\D/g, '').slice(0, 2);
  return code || DEFAULT_PROVINCE_CODE;
}

function getMarketPublic_(p) {
  geoMigrateSafe_();
  const province = marketProvinceCode_(p);
  const cache = CacheService.getScriptCache();
  const key = MARKET_CACHE_PREFIX + APP_VERSION + ':' + province;
  if (!(p && p.refresh === '1')) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const out = buildMarketPublic_(new Date(), province);
  try { cache.put(key, JSON.stringify(out), MARKET_CACHE_SECONDS); marketCacheKeys_(key); } catch (err) { /* too large to cache */ }
  return out;
}

/** Remembers which province caches exist so a save clears all of them (CacheService cannot list keys). */
function marketCacheKeys_(add) {
  const cache = CacheService.getScriptCache();
  const k = MARKET_CACHE_PREFIX + 'keys';
  let keys = [];
  try { keys = JSON.parse(cache.get(k) || '[]'); } catch (e) { keys = []; }
  if (add && keys.indexOf(add) < 0) { keys.push(add); cache.put(k, JSON.stringify(keys), 21600); }
  return keys;
}

/** The province's districts [{ code, name }]: boundary files, else (Kamphaeng Phet) the built-in list. */
function marketDistricts_(province) {
  try { return geoProvince_(province).districts.map(function (d) { return { code: d.code, name: d.name }; }); }
  catch (err) { return province === DEFAULT_PROVINCE_CODE ? districtList_().map(function (d) { return { code: d.code, name: d.name }; }) : []; }
}

/** Group of a listing: the crop decides when it is known (server rule), otherwise the material text. */
function marketGroupOfListing_(crop, material) {
  const g = cropGroupOf_(crop);
  return g !== 'other' ? g : materialGroupOf_(material);
}

function buildMarketPublic_(now, provinceCode) {
  const G = MARKET_GRID_DEG;
  const province = provinceCode || DEFAULT_PROVINCE_CODE;
  const districts = marketDistricts_(province);
  const dName = {}; districts.forEach(function (d) { dName[d.code] = d.name; });
  let provinceName = '';
  try { const pr = geoProvinceByCode_(province); provinceName = pr ? pr.name : ''; } catch (err) { /* offline */ }
  if (!provinceName && province === DEFAULT_PROVINCE_CODE) provinceName = provinceName_();
  const legacy = districtList_();   // rows saved before 3.0.0 and not filled yet: Kamphaeng Phet polygons
  const rowProv = function (r, kind) { return rowProvince_(r, kind) || DEFAULT_PROVINCE_CODE; };
  const rowDist = function (r, kind, lat, lng) {
    const code = rowDistrict_(r, kind);
    if (code) return code;
    const d = province === DEFAULT_PROVINCE_CODE ? districtForPoint_(lat, lng, legacy) : null;
    return d ? d.code : '';
  };
  const activity = {};   // province code → { plots, buyers }
  const act = function (code) { return activity[code] || (activity[code] = { plots: 0, buyers: 0 }); };
  const byDistrict = {};
  const distRow = function (code) {
    if (!code) return null;
    return byDistrict[code] || (byDistrict[code] = { code: code, name: dName[code] || '', sell: {}, buy: {}, sellers: {} });
  };
  const sellers = {};
  const groupSellers = {};
  const today = startOfDay_(now);
  const rule = marketHideRule_();
  let hidden = 0;
  const rates = {};
  // 2.6.0: residue rates (ตัน/ไร่) are ABM's — read from its public residue endpoint (Abm.gs), defaults if unreachable
  try { const r = abmResidueRates_(); Object.keys(r).forEach(function (k) { rates[k] = Number(r[k]); }); } catch (err) { /* defaults unknown */ }
  const groups = {};
  MARKET_GROUPS.forEach(function (g) {
    groups[g.key] = { key: g.key, label: g.label, residueTRai: rates[g.key] === undefined ? null : rates[g.key], others: {},
      sell: { plots: 0, readyPlots: 0, areaRai: 0, timing: marketEmptyTiming_() }, buy: { buyers: 0, capacityTonPerDay: 0, priceMin: null, priceMax: null } };
  });
  const cells = {};
  const cellOf = function (lat, lng, district) {
    const i = Math.floor(lat / G), j = Math.floor(lng / G), k = i + ':' + j;
    if (!cells[k]) {
      const cLat = (i + 0.5) * G, cLng = (j + 0.5) * G;
      cells[k] = { id: k, lat: round_(cLat, 4), lng: round_(cLng, 4), district: district || '', districtName: dName[district] || '', sell: {}, buy: {} };
    }
    return cells[k];
  };
  const price = function (b, v) {
    if (v === '' || !(v > 0)) return;
    b.priceMin = b.priceMin === null ? v : Math.min(b.priceMin, v);
    b.priceMax = b.priceMax === null ? v : Math.max(b.priceMax, v);
  };

  dataRows_(sheet_('farmers')).forEach(function (r) {
    if (String(r[11] || '').trim().toLowerCase() !== 'open' || !hasCoordinates_(r[9], r[10])) return;
    const listed = farmerListing_(r, rule, today).listed;
    const pc = rowProv(r, 'farmers');
    if (listed) act(pc).plots++;
    if (pc !== province) return;
    if (!listed) { hidden++; return; }
    const material = resolvedMaterial_(r[13], r[14], r[5]);
    const g = marketGroupOfListing_(r[5], material);
    const area = parseAreaRai_(r[8]);
    const harvest = toDate_(r[7]);
    const days = harvest ? Math.round((startOfDay_(harvest).getTime() - today.getTime()) / 86400000) : null;
    const ready = days === null || days <= MARKET_READY_DAYS;
    const dc = rowDist(r, 'farmers', Number(r[9]), Number(r[10]));
    const c = cellOf(Number(r[9]), Number(r[10]), dc);
    const owner = normalizePhone_(r[12]) || normalizePhone_(r[4]) || text_(r[0]);
    sellers[owner] = true;
    const dr = distRow(dc);
    if (dr) { const ds = dr.sell[g] || (dr.sell[g] = { plots: 0, areaRai: 0, sellers: {} }); ds.plots++; ds.areaRai += area; ds.sellers[owner] = true; dr.sellers[owner] = true; }
    const gs = groupSellers[g] || (groupSellers[g] = {}); gs[owner] = true;
    const s = c.sell[g] || (c.sell[g] = { plots: 0, readyPlots: 0, areaRai: 0, nextHarvest: null });
    s.plots++; s.areaRai += area; if (ready) s.readyPlots++;
    if (!ready && harvest) { const iso = dateInput_(harvest); if (!s.nextHarvest || iso < s.nextHarvest) s.nextHarvest = iso; }
    const t = groups[g].sell; t.plots++; t.areaRai += area; if (ready) t.readyPlots++;
    const tb = t.timing[marketTimingOf_(days)]; tb.plots++; tb.areaRai += area;
    if (g === 'other' && material) groups[g].others[material] = true;
  });

  dataRows_(sheet_('buyers')).forEach(function (r) {
    if (String(r[11] || '').trim().toLowerCase() !== 'active' || !hasCoordinates_(r[5], r[6])) return;
    const pc = rowProv(r, 'buyers');
    act(pc).buyers++;
    if (pc !== province) return;
    const material = resolvedMaterial_(r[13], r[14], r[7]);
    const g = materialGroupOf_(material);
    const cap = leadingNumber_(r[10]);
    const v = maybeNumber_(r[9]);
    const after = r[16] === '' || r[16] === undefined ? null : Number(r[16]);
    const dc = rowDist(r, 'buyers', Number(r[5]), Number(r[6]));
    const c = cellOf(Number(r[5]), Number(r[6]), dc);
    const dr = distRow(dc);
    if (dr) { const db = dr.buy[g] || (dr.buy[g] = { buyers: 0, capacityTonPerDay: 0 }); db.buyers++; db.capacityTonPerDay += cap; }
    const b = c.buy[g] || (c.buy[g] = { buyers: 0, capacityTonPerDay: 0, priceMin: null, priceMax: null, afterHarvestDays: null });
    b.buyers++; b.capacityTonPerDay += cap; price(b, v);
    if (after !== null && isFinite(after)) b.afterHarvestDays = b.afterHarvestDays === null ? after : Math.min(b.afterHarvestDays, after);
    const t = groups[g].buy; t.buyers++; t.capacityTonPerDay += cap; price(t, v);
    if (g === 'other' && material) groups[g].others[material] = true;
  });

  const ton = function (g, rai) { return rates[g] === undefined ? null : round_(rai * rates[g], 1); };
  const cellList = Object.keys(cells).sort().map(function (k) {
    const c = cells[k];
    Object.keys(c.sell).forEach(function (g) { const s = c.sell[g]; s.areaRai = round_(s.areaRai, 2); s.ton = ton(g, s.areaRai); });
    Object.keys(c.buy).forEach(function (g) { c.buy[g].capacityTonPerDay = round_(c.buy[g].capacityTonPerDay, 1); });
    return c;
  });
  const groupList = MARKET_GROUPS.map(function (x) {
    const g = groups[x.key];
    g.sell.areaRai = round_(g.sell.areaRai, 2); g.sell.ton = ton(x.key, g.sell.areaRai);
    g.sell.farmers = Object.keys(groupSellers[x.key] || {}).length;
    MARKET_TIMING.forEach(function (k) { const b = g.sell.timing[k]; b.areaRai = round_(b.areaRai, 2); b.ton = ton(x.key, b.areaRai); });
    g.buy.capacityTonPerDay = round_(g.buy.capacityTonPerDay, 1);
    g.others = Object.keys(g.others).slice(0, 6);
    return g;
  }).filter(function (g) { return g.sell.plots || g.buy.buyers || g.key !== 'other'; });
  const sum = function (f) { return groupList.reduce(function (a, g) { return a + f(g); }, 0); };
  // every district of the province, in code order; per material and in total (area, distinct sellers, tonnes, buyers)
  const districtList = districts.map(function (d) { return distRow(d.code); }).concat(Object.keys(byDistrict).filter(function (k) { return !dName[k]; }).map(function (k) { return byDistrict[k]; }))
    .map(function (dr) {
      const out = { code: dr.code, name: dr.name, sell: {}, buy: {}, farmers: Object.keys(dr.sellers).length, plots: 0, areaRai: 0, ton: 0, buyers: 0, capacityTonPerDay: 0 };
      let hasTon = false;
      Object.keys(dr.sell).forEach(function (g) {
        const v = dr.sell[g]; const t = ton(g, v.areaRai);
        out.sell[g] = { plots: v.plots, farmers: Object.keys(v.sellers).length, areaRai: round_(v.areaRai, 2), ton: t };
        out.plots += v.plots; out.areaRai += v.areaRai; if (t !== null) { out.ton += t; hasTon = true; }
      });
      Object.keys(dr.buy).forEach(function (g) {
        const v = dr.buy[g]; out.buy[g] = { buyers: v.buyers, capacityTonPerDay: round_(v.capacityTonPerDay, 1) };
        out.buyers += v.buyers; out.capacityTonPerDay += v.capacityTonPerDay;
      });
      out.areaRai = round_(out.areaRai, 2); out.ton = hasTon ? round_(out.ton, 1) : null; out.capacityTonPerDay = round_(out.capacityTonPerDay, 1);
      return out;
    });
  const provinces = Object.keys(activity).map(function (k) { return { code: k, plots: activity[k].plots, buyers: activity[k].buyers }; });
  return {
    ok: true, generatedAt: now.toISOString(), province: provinceName, provinceCode: province, gridDeg: G, gridKm: round_(G * 111, 1), readyDays: MARKET_READY_DAYS,
    groups: groupList, cells: cellList,
    districts: districts.map(function (d) { return { code: d.code, districtName: d.name }; }),
    byDistrict: districtList, provinces: provinces,
    listing: { hideAfterHarvestDays: rule.days, hiddenPlots: hidden },
    totals: { farmers: Object.keys(sellers).length, plots: sum(function (g) { return g.sell.plots; }), readyPlots: sum(function (g) { return g.sell.readyPlots; }),
      areaRai: round_(sum(function (g) { return g.sell.areaRai; }), 2), ton: round_(sum(function (g) { return g.sell.ton || 0; }), 1),
      buyers: sum(function (g) { return g.buy.buyers; }), capacityTonPerDay: round_(sum(function (g) { return g.buy.capacityTonPerDay; }), 1) },
    notes: {
      privacy: 'แสดงเป็นช่องพื้นที่ประมาณ ' + round_(G * 111, 1) + ' กม. ไม่มีชื่อ เบอร์โทร หรือพิกัดจริง — ดูตำแหน่งและติดต่อได้หลังเข้าสู่ระบบ',
      price: 'ราคาเป็นบาทต่อไร่ ตามที่ผู้รับซื้อระบุ',
      timing: 'ช่วงเวลานับจากวันเก็บเกี่ยวที่เกษตรกรระบุ: เก็บเกี่ยวแล้ว (พร้อมขายตอนนี้) · ภายใน 30 วัน · 31–90 วัน',
      listing: rule.days ? 'แสดงแปลงจนถึง ' + rule.days + ' วันหลังวันเก็บเกี่ยว (เกษตรกรกด "ยังมีวัสดุอยู่" เพื่อแสดงต่อได้)' : 'แสดงทุกแปลงที่ประกาศขาย',
      ton: 'ชีวมวลประมาณจากพื้นที่ × อัตราวัสดุเหลือใช้ต่อไร่ของพืช (ตั้งค่าในหน้าเจ้าหน้าที่)'
    }
  };
}
