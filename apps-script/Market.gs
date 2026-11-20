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

function getMarketPublic_(p) {
  const cache = CacheService.getScriptCache();
  const key = 'market:v2:' + APP_VERSION;
  if (!(p && p.refresh === '1')) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const out = buildMarketPublic_(new Date());
  try { cache.put(key, JSON.stringify(out), MARKET_CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return out;
}

/** Group of a listing: the crop decides when it is known (server rule), otherwise the material text. */
function marketGroupOfListing_(crop, material) {
  const g = cropGroupOf_(crop);
  return g !== 'other' ? g : materialGroupOf_(material);
}

function buildMarketPublic_(now) {
  const G = MARKET_GRID_DEG;
  const districts = districtList_();
  const today = startOfDay_(now);
  const rates = {};
  // 2.6.0: residue rates (ตัน/ไร่) are ABM's — read from its public residue endpoint (Abm.gs), defaults if unreachable
  try { const r = abmResidueRates_(); Object.keys(r).forEach(function (k) { rates[k] = Number(r[k]); }); } catch (err) { /* defaults unknown */ }
  const groups = {};
  MARKET_GROUPS.forEach(function (g) {
    groups[g.key] = { key: g.key, label: g.label, residueTRai: rates[g.key] === undefined ? null : rates[g.key], others: {},
      sell: { plots: 0, readyPlots: 0, areaRai: 0, timing: marketEmptyTiming_() }, buy: { buyers: 0, capacityTonPerDay: 0, priceMin: null, priceMax: null } };
  });
  const cells = {};
  const cellOf = function (lat, lng) {
    const i = Math.floor(lat / G), j = Math.floor(lng / G), k = i + ':' + j;
    if (!cells[k]) {
      const cLat = (i + 0.5) * G, cLng = (j + 0.5) * G;
      const d = districtForPoint_(lat, lng, districts);
      cells[k] = { id: k, lat: round_(cLat, 4), lng: round_(cLng, 4), district: d ? d.code : '', districtName: d ? d.name : '', sell: {}, buy: {} };
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
    const material = resolvedMaterial_(r[13], r[14], r[5]);
    const g = marketGroupOfListing_(r[5], material);
    const area = parseAreaRai_(r[8]);
    const harvest = toDate_(r[7]);
    const days = harvest ? Math.round((startOfDay_(harvest).getTime() - today.getTime()) / 86400000) : null;
    const ready = days === null || days <= MARKET_READY_DAYS;
    const c = cellOf(Number(r[9]), Number(r[10]));
    const s = c.sell[g] || (c.sell[g] = { plots: 0, readyPlots: 0, areaRai: 0, nextHarvest: null });
    s.plots++; s.areaRai += area; if (ready) s.readyPlots++;
    if (!ready && harvest) { const iso = dateInput_(harvest); if (!s.nextHarvest || iso < s.nextHarvest) s.nextHarvest = iso; }
    const t = groups[g].sell; t.plots++; t.areaRai += area; if (ready) t.readyPlots++;
    const tb = t.timing[marketTimingOf_(days)]; tb.plots++; tb.areaRai += area;
    if (g === 'other' && material) groups[g].others[material] = true;
  });

  dataRows_(sheet_('buyers')).forEach(function (r) {
    if (String(r[11] || '').trim().toLowerCase() !== 'active' || !hasCoordinates_(r[5], r[6])) return;
    const material = resolvedMaterial_(r[13], r[14], r[7]);
    const g = materialGroupOf_(material);
    const cap = leadingNumber_(r[10]);
    const v = maybeNumber_(r[9]);
    const after = r[16] === '' || r[16] === undefined ? null : Number(r[16]);
    const c = cellOf(Number(r[5]), Number(r[6]));
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
    MARKET_TIMING.forEach(function (k) { const b = g.sell.timing[k]; b.areaRai = round_(b.areaRai, 2); b.ton = ton(x.key, b.areaRai); });
    g.buy.capacityTonPerDay = round_(g.buy.capacityTonPerDay, 1);
    g.others = Object.keys(g.others).slice(0, 6);
    return g;
  }).filter(function (g) { return g.sell.plots || g.buy.buyers || g.key !== 'other'; });
  const sum = function (f) { return groupList.reduce(function (a, g) { return a + f(g); }, 0); };
  return {
    ok: true, generatedAt: now.toISOString(), province: provinceName_(), gridDeg: G, gridKm: round_(G * 111, 1), readyDays: MARKET_READY_DAYS,
    groups: groupList, cells: cellList,
    districts: districts.map(function (d) { return { code: d.code, districtName: d.name }; }),
    totals: { plots: sum(function (g) { return g.sell.plots; }), readyPlots: sum(function (g) { return g.sell.readyPlots; }),
      areaRai: round_(sum(function (g) { return g.sell.areaRai; }), 2), ton: round_(sum(function (g) { return g.sell.ton || 0; }), 1),
      buyers: sum(function (g) { return g.buy.buyers; }), capacityTonPerDay: round_(sum(function (g) { return g.buy.capacityTonPerDay; }), 1) },
    notes: {
      privacy: 'แสดงเป็นช่องพื้นที่ประมาณ ' + round_(G * 111, 1) + ' กม. ไม่มีชื่อ เบอร์โทร หรือพิกัดจริง — ดูตำแหน่งและติดต่อได้หลังเข้าสู่ระบบ',
      price: 'ราคาเป็นบาทต่อไร่ ตามที่ผู้รับซื้อระบุ',
      timing: 'ช่วงเวลานับจากวันเก็บเกี่ยวที่เกษตรกรระบุ: เก็บเกี่ยวแล้ว (พร้อมขายตอนนี้) · ภายใน 30 วัน · 31–90 วัน',
      ton: 'ตันวัสดุประมาณจากพื้นที่ × อัตราวัสดุต่อไร่ของพืช (ตั้งค่าในหน้าเจ้าหน้าที่)'
    }
  };
}
