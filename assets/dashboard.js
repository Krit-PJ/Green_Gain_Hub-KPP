/* Green Gain Hub 1.6.0 — public landing dashboard.
 *
 * One endpoint (?api=v1&endpoint=summary of the GGH backend) feeds four tabs:
 *   ภาพรวม        a short cross-source overview
 *   การเพาะปลูก    planted / harvested / remaining area by month and district
 *                  (DOAE farmer registry, imported by admins), sub-districts on demand
 *   รายงานอำเภอ    KPP Smart Agri-Materials district reports (proxied server-side)
 *   ตลาดเศษวัสดุ   Green Gain Hub plots for sale and buyers
 * Everything is aggregate data; no personal data is requested or rendered.
 */
(function () {
  'use strict';

  const cfg = window.GGH_CONFIG || {};
  const API_BASE = cfg.SUMMARY_API_URL || cfg.SHEETS_API_URL || '';
  const API_KEY = cfg.SUMMARY_API_KEY || '';
  const TIMEOUT = Number(cfg.REQUEST_TIMEOUT_MS) || 30000;
  const CACHE_KEY = 'ggh_summary_v1_6';
  const GEO_URL = 'assets/kpp-districts.geojson?v=1.5.0';
  const SEQ = ['--ggh-seq-1', '--ggh-seq-2', '--ggh-seq-3', '--ggh-seq-4', '--ggh-seq-5'];
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const REPORT_STATUS = { accepted: 'ตรวจรับแล้ว', submitted: 'ส่งแล้ว', draft: 'ยังไม่ส่ง (ร่าง)', returned: 'ส่งกลับแก้ไข', none: 'ยังไม่รายงาน' };
  const TABS = ['overview', 'crops', 'reports', 'market'];

  const state = { summary: null, geo: null, tab: 'overview', metricByTab: {}, selected: null, map: null, layer: null, layers: {},
    cropKey: '', asOf: null, detail: {} };
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

  /* ---------------- formatting ---------------- */
  function fmt(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits ?? 0 }).format(n);
  }
  function compact(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return Math.abs(n) >= 1e6 ? fmt(n / 1e6, 2) + ' ล้าน' : fmt(n, 0);
  }
  function ymLabel(ym, long) {
    const y = Math.floor(ym / 100), m = ym % 100;
    return long ? `${TH_MONTHS[m - 1]} ${y + 543}` : `${TH_M[m - 1]} ${String(y + 543).slice(-2)}`;
  }
  function keyLabel(key, long) { const [y, m] = key.split('-').map(Number); return ymLabel(y * 100 + m, long); }
  function addMonth(ym, n) { const y = Math.floor(ym / 100), m = ym % 100 - 1 + n; return (y + Math.floor(m / 12)) * 100 + ((m % 12) + 12) % 12 + 1; }
  function timeLabel(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function dateRange(a, b) {
    const f = (x) => { const d = new Date(x + 'T00:00:00'); return isNaN(d) ? x : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
    return b ? `${f(a)} – ${f(b)}` : f(a);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  /* ---------------- data access ---------------- */
  function summaryUrl(extra) {
    const q = new URLSearchParams({ api: 'v1', endpoint: 'summary' });
    if (API_KEY) q.set('key', API_KEY);
    Object.entries(extra || {}).forEach(([k, v]) => q.set(k, v));
    return API_BASE + (API_BASE.includes('?') ? '&' : '?') + q.toString();
  }
  function apiUrl(params) { return API_BASE + (API_BASE.includes('?') ? '&' : '?') + new URLSearchParams(params).toString(); }
  function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetch(url, { signal: ctrl.signal, redirect: 'follow' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(timer));
  }
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__ggh_sum_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const timer = setTimeout(() => { done(); reject(new Error('API timeout')); }, TIMEOUT);
      function done() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (payload) => { done(); resolve(payload); };
      s.src = url + '&callback=' + cb;
      s.onerror = () => { done(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }
  function loadSummary() {
    if (!API_BASE || API_BASE.includes('PUT_YOUR')) return Promise.reject(new Error('ยังไม่ได้กำหนด SUMMARY_API_URL ใน assets/config.js'));
    return getJson(summaryUrl()).catch(() => jsonp(summaryUrl())).then((payload) => {
      if (!payload || payload.ok === false) {
        const msg = payload && payload.error || 'API error';
        throw new Error(/Invalid action/i.test(msg) ? 'Apps Script ยังเป็นรุ่นเก่า กรุณา Deploy รุ่นล่าสุด' : msg);
      }
      if (!payload.data || !payload.data.totals) throw new Error('API ส่งข้อมูลสรุปไม่ครบ');
      return payload.data;
    });
  }
  function readCache() { try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function writeCache(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ } }
  function loadGeo() { return fetch(GEO_URL).then((r) => { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); }); }

  /* market (GGH) */
  function market(code) {
    const list = (state.summary && state.summary.byDistrict) || [];
    return list.find((d) => d.code === code) || { code, plots: 0, farmers: 0, areaRai: 0, buyers: 0, capacityTonPerDay: 0, residueTon: null, materials: [] };
  }
  /* Smart Agri reports */
  function reports() { const r = state.summary && state.summary.reports; return r && r.ok ? r : null; }
  function reportFor(code) { const r = reports(); return r ? (r.byDistrict || []).find((d) => d.code === code) || null : null; }
  function reportValue(code, id) {
    const x = reportFor(code)?.items?.[id];
    return x && x.cumulative !== null && x.cumulative !== undefined ? Number(x.cumulative) : null;
  }
  function reportItem(id) { const r = reports(); return r ? (r.items || []).find((x) => x.id === id) || null : null; }
  /* crops (farmer registry) */
  function cropList() { const c = state.summary && state.summary.crops; return c && c.ok ? c.crops || [] : []; }
  function cropKeyOf(c) { return c.crop + '|' + c.season; }
  function crop() { const list = cropList(); return list.find((c) => cropKeyOf(c) === state.cropKey) || list[0] || null; }
  function asOf() { const c = crop(); return state.asOf || (c ? c.asOfMonth : null); }
  function cropTotals(c, m) {
    const months = c.months || [];
    const total = months.reduce((s, x) => s + x.areaRai, 0);
    const harvested = months.filter((x) => x.month <= m).reduce((s, x) => s + x.areaRai, 0);
    const next = (months.find((x) => x.month === addMonth(m, 1)) || {}).areaRai || 0;
    return { total, harvested, remaining: total - harvested, next };
  }
  function cropDistrict(code) {
    const c = crop();
    const d = c && (c.byDistrict || []).find((x) => x.code === code);
    if (!d) return null;
    const m = asOf();
    const months = d.months || {};
    const harvested = Object.keys(months).filter((k) => Number(k) <= m).reduce((s, k) => s + months[k], 0);
    return { total: d.totalRai, harvested, remaining: d.totalRai - harvested, next: months[String(addMonth(m, 1))] || 0, months };
  }

  const METRICS = {
    cropRemaining: { label: 'คงเหลือยังไม่เก็บเกี่ยว (ไร่)', digits: 0, value: (c) => cropDistrict(c)?.remaining ?? null, needs: 'crop' },
    cropHarvested: { label: 'เก็บเกี่ยวแล้ว (ไร่)', digits: 0, value: (c) => cropDistrict(c)?.harvested ?? null, needs: 'crop' },
    cropTotal: { label: 'พื้นที่ปลูก (ไร่)', digits: 0, value: (c) => cropDistrict(c)?.total ?? null, needs: 'crop' },
    cropNext: { label: 'คาดว่าจะเก็บเกี่ยวเดือนถัดไป (ไร่)', digits: 0, value: (c) => cropDistrict(c)?.next ?? null, needs: 'crop' },
    R31: { label: 'ไถกลบ/ย่อยสลาย (ไร่)', digits: 0, value: (c) => reportValue(c, 'R31'), needs: 'reports' },
    R30: { label: 'แปรรูป (หมู่บ้าน)', digits: 0, value: (c) => reportValue(c, 'R30'), needs: 'reports' },
    R29: { label: 'ส่งเสริม (ครั้ง)', digits: 0, value: (c) => reportValue(c, 'R29'), needs: 'reports' },
    areaRai: { label: 'แปลงพร้อมขาย (ไร่)', digits: 1, value: (c) => market(c).areaRai },
    buyers: { label: 'จุดรับซื้อ', digits: 0, value: (c) => market(c).buyers }
  };
  const TAB_METRICS = {
    overview: ['cropRemaining', 'R31', 'areaRai'],
    crops: ['cropRemaining', 'cropHarvested', 'cropTotal', 'cropNext'],
    reports: ['R31', 'R30', 'R29'],
    market: ['areaRai', 'buyers']
  };
  function metricAvailable(id) {
    const need = METRICS[id].needs;
    if (need === 'crop') return !!crop();
    if (need === 'reports') return !!reports();
    return true;
  }
  function defaultMetric(tab) {
    if (tab === 'overview') {
      if (crop()) return 'cropRemaining';
      return reports() && reports().reportedCount > 0 ? 'R31' : 'areaRai';
    }
    const list = TAB_METRICS[tab].filter(metricAvailable);
    if (tab === 'reports' && !(reports() && reports().reportedCount > 0)) return list[0] || 'R31';
    return list[0] || TAB_METRICS[tab][0];
  }
  function metric() {
    const chosen = state.metricByTab[state.tab];
    return chosen && metricAvailable(chosen) ? chosen : defaultMetric(state.tab);
  }

  /* ---------------- tooltip ---------------- */
  function showTip(html, x, y) {
    const tip = $('dashTooltip'); if (!tip) return;
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { const tip = $('dashTooltip'); if (tip) tip.hidden = true; }
  function bindTip(el, html) {
    el.addEventListener('mousemove', (e) => showTip(html, e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(html, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', hideTip);
  }
  const statusChip = (s) => { const st = REPORT_STATUS[s] ? s : 'none'; return `<span class="ggh-status s-${st}">${esc(REPORT_STATUS[st])}</span>`; };

  /* ---------------- KPI band ---------------- */
  function kpi(value, label, sub, cls) {
    return `<div class="ggh-kpi ${cls || ''}"><span class="ggh-kpi-value">${value}</span><span class="ggh-kpi-label">${label}</span><span class="ggh-kpi-sub">${sub || ''}</span></div>`;
  }
  function renderKpis() {
    const s = state.summary, el = $('dashKpis');
    if (!el) return;
    let title = '', meta = '', html = '';
    const c = crop(), m = asOf(), r = reports();
    const t = c ? cropTotals(c, m) : null;
    if (state.tab === 'overview') {
      title = 'ภาพรวมจังหวัด';
      meta = c ? `${esc(c.crop)} ปีการผลิต ${esc(c.season)}` : '';
      html += c ? kpi(fmt(t.remaining), `ไร่ ${esc(c.crop)} ยังไม่เก็บเกี่ยว`, `ณ สิ้น${ymLabel(m, true)} จากทั้งหมด ${fmt(t.total)} ไร่`, 'ggh-kpi-hero')
        : kpi('–', 'ไร่ ยังไม่เก็บเกี่ยว', 'ยังไม่มีข้อมูลเพาะปลูก', 'ggh-kpi-hero');
      html += c ? kpi(fmt(t.next), `ไร่ คาดว่าจะเก็บเกี่ยว ${ymLabel(addMonth(m, 1), true)}`, c.residue ? `เศษวัสดุ ${esc(c.material)} ราว ${fmt(t.next * c.residue.bioRateTonPerRai)} ตัน` : `เศษวัสดุ: ${esc(c.material || '–')}`, 'ggh-kpi-harvest')
        : kpi('–', 'ไร่ คาดว่าจะเก็บเกี่ยวเดือนถัดไป', '');
      const r31 = reportItem('R31');
      html += kpi(r && r31 && r31.cumulative !== null ? fmt(r31.cumulative) : '–', 'ไร่ ไถกลบตอซัง/ใช้สารย่อยสลาย', r ? `อำเภอส่งรายงาน ${fmt(r.reportedCount)}/${fmt(r.districtsTotal)}` : 'ยังโหลดรายงานอำเภอไม่ได้');
      html += s ? kpi(fmt(s.totals.farmerPlots), 'แปลงพร้อมขายใน Green Gain Hub', `จุดรับซื้อ ${fmt(s.totals.buyers)} แห่ง`) : kpi('–', 'แปลงพร้อมขาย', '');
    } else if (state.tab === 'crops') {
      if (!c) {
        title = 'การเพาะปลูก';
        html = '<p class="ggh-kpi-empty">ยังไม่มีข้อมูลเพาะปลูก ผู้ดูแลระบบนำเข้าได้จากรายงานทะเบียนเกษตรกร</p>';
      } else {
        title = `${c.crop} ปีการผลิต ${c.season}`;
        meta = `ทะเบียนเกษตรกร นำเข้าเมื่อ ${esc(c.importedAt || '')}`;
        html += kpi(fmt(t.total), 'ไร่ พื้นที่ปลูกทั้งหมด', `${ymLabel(c.firstMonth)} – ${ymLabel(c.lastMonth)} เก็บเกี่ยว ${(c.months || []).length} เดือน`);
        html += kpi(fmt(t.harvested), `ไร่ เก็บเกี่ยวแล้ว ถึงสิ้น${ymLabel(m, true)}`, `${pct(t.harvested, t.total)}% ของพื้นที่ปลูก`);
        html += kpi(fmt(t.remaining), 'ไร่ คงเหลือยังไม่เก็บเกี่ยว', `${pct(t.remaining, t.total)}% ของพื้นที่ปลูก` + (c.residue ? `, ${esc(c.material)} ราว ${fmt(t.remaining * c.residue.bioRateTonPerRai)} ตัน` : ''), 'ggh-kpi-hero');
        html += kpi(fmt(t.next), `ไร่ คาดว่าจะเก็บเกี่ยว ${ymLabel(addMonth(m, 1), true)}`, `เศษวัสดุ: ${esc(c.material || '–')}`, 'ggh-kpi-harvest');
      }
    } else if (state.tab === 'reports') {
      title = 'ผลการจัดการเศษวัสดุ รายงานจากอำเภอ';
      if (!r) {
        html = `<p class="ggh-kpi-empty">${s && s.reports && s.reports.configured === false ? 'กำลังเชื่อมต่อระบบรายงานอำเภอ' : 'ยังโหลดข้อมูลรายงานอำเภอไม่ได้'}</p>`;
      } else {
        meta = r.round && r.round.round ? `${esc(r.round.label)}${r.round.start ? ` (${dateRange(r.round.start, r.round.end)})` : ''}` : '';
        const none = !r.reportedCount;
        [['R31', 'ไร่ ไถกลบตอซัง/ใช้สารย่อยสลาย', 'ggh-kpi-hero'], ['R30', 'หมู่บ้าน/ชุมชน แปรรูปวัสดุเพิ่มมูลค่า', ''], ['R29', 'ครั้ง ส่งเสริมแปรรูปแทนการเผา', '']].forEach(([id, label, cls]) => {
          const it = reportItem(id);
          html += kpi(it && it.cumulative !== null ? fmt(it.cumulative) : '–', label,
            none ? 'รอรายงานจากอำเภอ' : (it ? (it.week !== null ? `ครั้งล่าสุด +${fmt(it.week)}, ` : '') + `${fmt(it.districtsYes)} อำเภอดำเนินการ` : ''), cls);
        });
        const sc = r.statusCounts || {};
        html += kpi(`${fmt(r.reportedCount)}/${fmt(r.districtsTotal)}`, 'อำเภอที่ส่งรายงานแล้ว',
          none ? (r.round && r.round.due ? `ครบกำหนดส่ง ${dateRange(r.round.due)}` : '') : `ตรวจรับแล้ว ${fmt(sc.accepted || 0)}, รอตรวจ ${fmt(sc.submitted || 0)}`);
      }
    } else if (state.tab === 'market' && s) {
      title = 'ตลาดเศษวัสดุ Green Gain Hub';
      const tt = s.totals;
      html += kpi(fmt(tt.farmerPlots), 'แปลงพร้อมขาย', `จากเกษตรกร ${fmt(tt.farmers)} ราย`);
      html += kpi(fmt(tt.areaRai, 1), 'ไร่ พื้นที่แปลงพร้อมขาย', `ครอบคลุม ${fmt(tt.districtsCovered)} จาก ${fmt(tt.districtsTotal)} อำเภอ`);
      html += kpi(fmt(s.upcomingHarvest.days30.areaRai, 1), 'ไร่ ที่จะเก็บเกี่ยวใน 30 วัน', `${fmt(s.upcomingHarvest.days30.plots)} แปลง`, 'ggh-kpi-harvest');
      html += kpi(fmt(tt.buyers), 'จุดรับซื้อ', `รับได้รวม ${fmt(tt.capacityTonPerDay, 1)} ตัน/วัน`);
      html += kpi(tt.avgBuyerPriceBahtPerRai === null ? '–' : fmt(tt.avgBuyerPriceBahtPerRai), 'บาท/ไร่ ราคารับซื้อเฉลี่ย', tt.potentialValueBaht === null ? '' : `มูลค่าศักยภาพ ≈ ${compact(tt.potentialValueBaht)} บาท`);
    }
    $('dashKpiTitle').textContent = title;
    $('dashKpiMeta').innerHTML = meta;
    el.classList.toggle('ggh-kpis-5', state.tab === 'market');
    el.innerHTML = html;
  }

  /* ---------------- crop toolbar ---------------- */
  function renderCropToolbar() {
    const chips = $('dashCropChips'), sel = $('dashAsOf');
    if (!chips || !sel) return;
    const list = cropList();
    const names = {};
    list.forEach((c) => { names[c.crop] = (names[c.crop] || 0) + 1; });
    const cur = crop();
    chips.innerHTML = list.length ? list.map((c) => {
      const k = cropKeyOf(c);
      return `<button type="button" role="radio" aria-checked="${cur && k === cropKeyOf(cur)}" data-key="${esc(k)}">${esc(c.crop)}${names[c.crop] > 1 ? ` <small>${esc(c.season)}</small>` : ''}</button>`;
    }).join('') : '<span class="ggh-district-empty">ยังไม่มีข้อมูลเพาะปลูก</span>';
    chips.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
      state.cropKey = b.dataset.key; state.asOf = null; state.detail = {}; renderAll();
    }));
    if (!cur) { sel.innerHTML = ''; sel.disabled = true; return; }
    sel.disabled = false;
    const opts = [];
    for (let ym = addMonth(cur.firstMonth, -1); ym <= cur.lastMonth; ym = addMonth(ym, 1)) opts.push(ym);
    if (!opts.includes(cur.asOfMonth)) opts.push(cur.asOfMonth);
    opts.sort((a, b) => a - b);
    const m = asOf();
    sel.innerHTML = opts.map((ym) => `<option value="${ym}" ${ym === m ? 'selected' : ''}>${ymLabel(ym, true)}${ym === cur.asOfMonth ? ' (เดือนที่ผ่านมา)' : ''}</option>`).join('');
  }

  /* ---------------- map ---------------- */
  function breaks(id) {
    const codes = state.geo ? state.geo.features.map((f) => f.properties.code) : [];
    const max = Math.max(0, ...codes.map((c) => Number(METRICS[id].value(c)) || 0));
    if (max <= 0) return [];
    const step = max / SEQ.length;
    return SEQ.map((_, i) => step * (i + 1));
  }
  function colorFor(v, br) {
    if (!v || !br.length) return css('--ggh-zero');
    for (let i = 0; i < br.length; i++) if (v <= br[i] + 1e-9) return css(SEQ[i]);
    return css(SEQ[SEQ.length - 1]);
  }
  function ensureMap() {
    if (state.map || !window.L || !$('dashMap')) return state.map;
    state.map = L.map('dashMap', { scrollWheelZoom: false, zoomSnap: 0.25 });
    // OpenStreetMap tiles, as on the logged-in map (CARTO basemaps now require an API key).
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, className: 'ggh-basemap',
      attribution: '&copy; OpenStreetMap contributors · ขอบเขตอำเภอ: OpenGISData-Thailand (CC BY 4.0)'
    }).addTo(state.map);
    state.map.setView([16.3, 99.6], 9);
    return state.map;
  }
  function renderMap() {
    const map = ensureMap();
    if (!map || !state.geo) return;
    const id = metric(), br = breaks(id);
    if (state.layer) { map.removeLayer(state.layer); state.layers = {}; }
    state.layer = L.geoJSON(state.geo, {
      style: (f) => ({ color: '#ffffff', weight: 1.5, fillOpacity: 0.85, fillColor: colorFor(METRICS[id].value(f.properties.code), br) }),
      onEachFeature: (f, layer) => {
        state.layers[f.properties.code] = layer;
        layer.bindTooltip(f.properties.name, { permanent: true, direction: 'center', className: 'ggh-map-label' });
        layer.on({
          mouseover: (e) => { layer.setStyle({ weight: 3, color: css('--ggh-green-dark') }); layer.bringToFront(); showTip(districtTip(f.properties), e.originalEvent.clientX, e.originalEvent.clientY); },
          mousemove: (e) => showTip(districtTip(f.properties), e.originalEvent.clientX, e.originalEvent.clientY),
          mouseout: () => { hideTip(); restyleSelection(); },
          click: () => selectDistrict(f.properties.code, false)
        });
      }
    }).addTo(map);
    if (!state.fitted) { map.fitBounds(state.layer.getBounds(), { padding: [12, 12] }); state.fitted = true; }
    restyleSelection();
    renderLegend(id, br);
  }
  function districtTip(p) {
    const id = metric();
    const v = METRICS[id].value(p.code);
    let extra = '';
    if (METRICS[id].needs === 'crop') {
      const d = cropDistrict(p.code);
      if (d) extra = `<br>ปลูก ${fmt(d.total)} ไร่, เก็บเกี่ยวแล้ว ${pct(d.harvested, d.total)}%`;
    } else if (METRICS[id].needs === 'reports') {
      extra = `<br>${esc(REPORT_STATUS[reportFor(p.code)?.status] || REPORT_STATUS.none)}`;
    }
    return `<strong>อ.${esc(p.name)}</strong><br>${esc(METRICS[id].label)}: ${v === null ? 'ไม่มีข้อมูล' : fmt(v, METRICS[id].digits)}${extra}`;
  }
  function restyleSelection() {
    Object.entries(state.layers).forEach(([code, layer]) => {
      const on = code === state.selected;
      layer.setStyle({ weight: on ? 3.5 : 1.5, color: on ? css('--ggh-green-dark') : '#ffffff' });
      if (on) layer.bringToFront();
    });
  }
  function renderLegend(id, br) {
    const el = $('dashLegend'); if (!el) return;
    const m = METRICS[id];
    if (!br.length) { el.innerHTML = `<span><span class="sw" style="background:${css('--ggh-zero')}"></span>ยังไม่มีข้อมูล ${esc(m.label)}</span>`; return; }
    let lo = 0;
    el.innerHTML = `<span>${esc(m.label)}:</span><span><span class="sw" style="background:${css('--ggh-zero')}"></span>ไม่มีข้อมูล</span>` +
      br.map((hi, i) => { const t = `${fmt(lo, m.digits)}–${fmt(hi, m.digits)}`; lo = hi; return `<span><span class="sw" style="background:${css(SEQ[i])}"></span>${t}</span>`; }).join('');
  }
  function renderMetrics() {
    const box = $('dashMetrics'); if (!box) return;
    const cur = metric();
    box.innerHTML = TAB_METRICS[state.tab].map((id) => {
      const ok = metricAvailable(id);
      return `<button type="button" role="radio" data-metric="${id}" aria-checked="${id === cur}" ${ok ? '' : 'disabled title="ยังไม่มีข้อมูล"'}>${esc(shortLabel(id))}</button>`;
    }).join('');
    const btns = [...box.querySelectorAll('[data-metric]')];
    btns.forEach((b) => {
      b.addEventListener('click', () => { if (b.disabled) return; state.metricByTab[state.tab] = b.dataset.metric; renderMetrics(); renderMap(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const live = btns.filter((x) => !x.disabled);
        const next = live[(live.indexOf(b) + (e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
        next.focus(); next.click();
      });
    });
  }
  function shortLabel(id) {
    return { cropRemaining: 'คงเหลือ', cropHarvested: 'เก็บเกี่ยวแล้ว', cropTotal: 'พื้นที่ปลูก', cropNext: 'เดือนถัดไป',
      R31: 'ไถกลบ/ย่อยสลาย', R30: 'แปรรูป', R29: 'ส่งเสริม', areaRai: 'แปลงพร้อมขาย', buyers: 'จุดรับซื้อ' }[id] || METRICS[id].label;
  }

  /* ---------------- district panel ---------------- */
  function districtName(code) {
    if (code === 'OTHER') return 'นอกเขต/ไม่ระบุพิกัด';
    const f = state.geo && state.geo.features.find((x) => x.properties.code === code);
    return f ? f.properties.name : code;
  }
  function selectDistrict(code, zoom) {
    state.selected = state.selected === code && !zoom ? null : code;
    restyleSelection();
    renderDistrictPanel();
    document.querySelectorAll('#dashTable tr').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.code === state.selected));
    if (zoom && state.selected && state.layers[code] && state.map) state.map.fitBounds(state.layers[code].getBounds(), { padding: [30, 30], maxZoom: 11 });
  }
  const dl = (pairs) => `<dl>${pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  function cropSection(code, withSub) {
    const c = crop(), d = cropDistrict(code);
    if (!c) return '';
    if (!d) return `<h4><span>${esc(c.crop)} ${esc(c.season)}</span></h4><p class="ggh-district-empty">ไม่มีพื้นที่ปลูกในทะเบียน</p>`;
    const m = asOf();
    let html = `<h4><span>${esc(c.crop)} ${esc(c.season)}</span><span class="ggh-kpi-group-meta">ณ สิ้น${ymLabel(m)}</span></h4>` + dl([
      ['พื้นที่ปลูก (ไร่)', fmt(d.total)], ['เก็บเกี่ยวแล้ว (ไร่)', `${fmt(d.harvested)} <small>${pct(d.harvested, d.total)}%</small>`],
      ['คงเหลือ (ไร่)', fmt(d.remaining)], [`คาดเก็บเกี่ยว ${ymLabel(addMonth(m, 1))}`, fmt(d.next)]]);
    if (withSub) {
      const key = `${cropKeyOf(c)}|${code}`;
      const det = state.detail[key];
      if (det === undefined) { state.detail[key] = null; loadCropDetail(c, code, key); }
      if (!det) html += '<p class="ggh-district-empty">กำลังโหลดรายตำบล…</p>';
      else if (det.error) html += `<p class="ggh-district-empty">โหลดรายตำบลไม่สำเร็จ</p>`;
      else {
        const rows = det.subdistricts.map((t) => {
          const h = Object.keys(t.months).filter((k) => Number(k) <= m).reduce((s, k) => s + t.months[k], 0);
          return `<tr><td>${esc(t.name)}</td><td class="num">${fmt(t.totalRai)}</td><td class="num">${fmt(t.totalRai - h)}</td></tr>`;
        }).join('');
        html += `<div class="ggh-subtable"><table><thead><tr><th>ตำบล</th><th class="num">ปลูก</th><th class="num">คงเหลือ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    }
    return html;
  }
  function loadCropDetail(c, code, key) {
    const url = apiUrl({ api: 'v1', endpoint: 'crop', crop: c.crop, season: c.season, district: code });
    getJson(url).catch(() => jsonp(url)).then((p) => {
      state.detail[key] = p && p.ok ? p.data : { error: true };
    }).catch(() => { state.detail[key] = { error: true }; })
      .finally(() => { if (state.selected === code) renderDistrictPanel(); });
  }
  function reportSection(code) {
    if (!reports()) return '';
    const v = (id) => { const x = reportValue(code, id); return x === null ? '–' : fmt(x); };
    return `<h4><span>รายงานการจัดการเศษวัสดุ</span>${statusChip(reportFor(code)?.status)}</h4>` +
      dl([['ไถกลบ/ย่อยสลาย (ไร่)', v('R31')], ['แปรรูป (หมู่บ้าน/ชุมชน)', v('R30')], ['ส่งเสริม (ครั้ง)', v('R29')]]);
  }
  function marketSection(code, full) {
    const d = market(code);
    const pairs = [['แปลงพร้อมขาย', fmt(d.plots)], ['พื้นที่ (ไร่)', fmt(d.areaRai, 1)], ['จุดรับซื้อ', fmt(d.buyers)]];
    if (full) pairs.push(['รับซื้อได้ (ตัน/วัน)', fmt(d.capacityTonPerDay, 1)]);
    const mats = full ? (d.materials || []).map((m) => `<li><span>${esc(m.material)}</span><span>${fmt(m.areaRai, 1)} ไร่</span></li>`).join('') : '';
    return `<h4><span>ตลาด Green Gain Hub</span></h4>` + dl(pairs) + (mats ? `<ul>${mats}</ul>` : '');
  }
  function renderDistrictPanel() {
    const el = $('dashDistrict'); if (!el) return;
    const code = state.selected;
    if (!code) { el.innerHTML = '<p class="ggh-district-empty">เลือกอำเภอบนแผนที่ หรือค้นหาชื่ออำเภอ เพื่อดูรายละเอียด</p>'; return; }
    let body = '';
    if (code === 'OTHER') body = marketSection(code, true);
    else if (state.tab === 'crops') body = cropSection(code, true);
    else if (state.tab === 'reports') body = reportSection(code);
    else if (state.tab === 'market') body = marketSection(code, true);
    else body = cropSection(code, false) + reportSection(code) + marketSection(code, false);
    el.innerHTML = `<h3><span>${code === 'OTHER' ? '' : 'อ.'}${esc(districtName(code))}</span><button type="button" data-clear>ล้างการเลือก</button></h3>${body}`;
    el.querySelector('[data-clear]').addEventListener('click', () => selectDistrict(code, false));
  }

  /* ---------------- district table ---------------- */
  function renderTable() {
    const head = $('dashTableHead'), body = $('dashTable');
    if (!head || !body || state.tab === 'overview') return;
    const codes = state.geo ? state.geo.features.map((f) => f.properties.code) : [];
    const dash = (v, d) => (v === null || v === undefined ? '–' : fmt(v, d || 0));
    let cols = [], rows = [];
    if (state.tab === 'crops') {
      const c = crop(), m = asOf();
      $('dashTableSub').textContent = c ? `${c.crop} ปี ${c.season} ณ สิ้น${ymLabel(m, true)} เลือกแถวเพื่อดูรายตำบล` : 'ยังไม่มีข้อมูลเพาะปลูก';
      cols = ['อำเภอ', ['พื้นที่ปลูก (ไร่)', 1], ['เก็บเกี่ยวแล้ว', 1], ['คงเหลือ', 1], ['สัดส่วนเก็บเกี่ยว', 2], [`คาดเก็บเกี่ยว ${ymLabel(addMonth(m || 0, 1))}`, 1]];
      rows = codes.map((code) => ({ code, d: cropDistrict(code) })).sort((a, b) => (b.d?.total || 0) - (a.d?.total || 0)).map(({ code, d }) => ({
        code, empty: !d, cells: [esc(districtName(code)), dash(d?.total), dash(d?.harvested), dash(d?.remaining),
          `<div class="ggh-progress" title="${d ? pct(d.harvested, d.total) : 0}%"><i style="width:${d ? pct(d.harvested, d.total) : 0}%"></i></div><small>${d ? pct(d.harvested, d.total) + '%' : ''}</small>`, dash(d?.next)]
      }));
    } else if (state.tab === 'reports') {
      $('dashTableSub').textContent = 'ยอดสะสมถึงรายงานครั้งล่าสุด จากรายงานที่ส่งแล้วหรือตรวจรับแล้ว';
      const max = Math.max(0, ...codes.map((c) => reportValue(c, 'R31') || 0));
      cols = ['อำเภอ', 'รายงาน', ['ไถกลบ/ย่อยสลาย (ไร่)', 1], ['', 2], ['แปรรูป (หมู่บ้าน)', 1], ['ส่งเสริม (ครั้ง)', 1]];
      rows = codes.map((code) => ({ code, v: reportValue(code, 'R31') })).sort((a, b) => (b.v || 0) - (a.v || 0)).map(({ code, v }) => ({
        code, empty: v === null, cells: [esc(districtName(code)), reports() ? statusChip(reportFor(code)?.status) : '–', dash(v),
          `<div class="ggh-inline-bar" style="width:${max ? ((v || 0) / max * 100).toFixed(1) : 0}%"></div>`, dash(reportValue(code, 'R30')), dash(reportValue(code, 'R29'))]
      }));
    } else {
      $('dashTableSub').textContent = 'แปลงที่ลงทะเบียนพร้อมขาย และจุดรับซื้อสถานะใช้งาน';
      const list = codes.slice();
      if ((state.summary?.byDistrict || []).some((d) => d.code === 'OTHER')) list.push('OTHER');
      const max = Math.max(0, ...list.map((c) => market(c).areaRai));
      cols = ['อำเภอ', ['แปลง', 1], ['พื้นที่ (ไร่)', 1], ['', 2], ['จุดรับซื้อ', 1], ['ตัน/วัน', 1]];
      rows = list.map((code) => ({ code, d: market(code) })).sort((a, b) => (a.code === 'OTHER') - (b.code === 'OTHER') || b.d.areaRai - a.d.areaRai || b.d.buyers - a.d.buyers).map(({ code, d }) => ({
        code, empty: !(d.plots || d.buyers), cells: [esc(districtName(code)), fmt(d.plots), fmt(d.areaRai, 1),
          `<div class="ggh-inline-bar" style="width:${max ? (d.areaRai / max * 100).toFixed(1) : 0}%"></div>`, fmt(d.buyers), fmt(d.capacityTonPerDay, 1)]
      }));
    }
    head.innerHTML = '<tr>' + cols.map((c) => Array.isArray(c) ? `<th scope="col" class="${c[1] === 1 ? 'num' : 'ggh-col-share'}">${esc(c[0]) || '<span class="sr-only">สัดส่วน</span>'}</th>` : `<th scope="col">${esc(c)}</th>`).join('') + '</tr>';
    body.innerHTML = rows.map((r) => `<tr tabindex="0" data-code="${esc(r.code)}" class="${[r.empty ? 'is-zero' : '', r.code === state.selected ? 'is-selected' : ''].join(' ').trim()}">` +
      r.cells.map((cell, i) => `<td class="${Array.isArray(cols[i]) && cols[i][1] === 1 ? 'num' : ''}">${cell}</td>`).join('') + '</tr>').join('');
    body.querySelectorAll('tr').forEach((tr) => {
      const go = () => { selectDistrict(tr.dataset.code, tr.dataset.code !== 'OTHER'); if (window.innerWidth < 1024) $('dashDistrict').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  /* ---------------- charts ---------------- */
  function columns(el, items, opts) {
    const max = Math.max(0, ...items.map((x) => x.value));
    el.style.setProperty('--cols', String(items.length || 1));
    el.innerHTML = items.map((x, i) => {
      const h = max ? (x.value / max) * 100 : 0;
      return `<div class="ggh-col ${x.cls || ''} ${x.value ? '' : 'is-empty'}" tabindex="0" data-i="${i}" aria-label="${esc(x.aria)}">
        <div class="ggh-col-bar" style="height:${Math.max(x.value ? 3 : 1, h * 0.82).toFixed(1)}%"></div>
        ${x.showValue && x.value ? `<span class="ggh-col-value" style="bottom:calc(${(h * 0.82).toFixed(1)}% + 1.5rem)">${opts.short(x.value)}</span>` : ''}
        <span class="ggh-col-label">${esc(x.label)}</span></div>`;
    }).join('');
    el.querySelectorAll('.ggh-col').forEach((col) => bindTip(col, items[Number(col.dataset.i)].tip));
  }
  const shortRai = (v) => (v >= 1000 ? fmt(v / 1000, v >= 100000 ? 0 : 1) + 'k' : fmt(v));

  function renderCropCharts() {
    const c = crop(), el = $('dashCropMonths'), st = $('dashCropStack');
    if (!el || !st) return;
    if (!c) {
      $('dashCropMonthsSub').textContent = '';
      el.innerHTML = '<p class="ggh-district-empty ggh-trend-empty">ยังไม่มีข้อมูลเพาะปลูก ผู้ดูแลระบบนำเข้าได้จากรายงานทะเบียนเกษตรกร (เมนู สำหรับเจ้าหน้าที่)</p>';
      st.innerHTML = '';
      return;
    }
    const m = asOf(), next = addMonth(m, 1);
    $('dashCropMonthsSub').textContent = `${c.crop} ปีการผลิต ${c.season}: พื้นที่ (ไร่) ตามเดือนที่คาดว่าจะเก็บเกี่ยว จากทะเบียนเกษตรกร`;
    const months = c.months || [];
    const max = Math.max(0, ...months.map((x) => x.areaRai));
    columns(el, months.map((x) => ({
      value: x.areaRai, label: ymLabel(x.month), aria: `${ymLabel(x.month, true)}: ${fmt(x.areaRai)} ไร่`,
      cls: x.month <= m ? 'is-past' : x.month === next ? 'is-current' : '', showValue: x.areaRai === max || x.month === next,
      tip: `<strong>${ymLabel(x.month, true)}</strong><br>${fmt(x.areaRai, 2)} ไร่<br>${fmt(x.households)} ครัวเรือน, ${fmt(x.plots)} แปลง` +
        (c.residue ? `<br>${esc(c.material)} ราว ${fmt(x.areaRai * c.residue.bioRateTonPerRai)} ตัน` : '')
    })), { short: shortRai });
    let legend = el.nextElementSibling;
    if (!legend || !legend.classList.contains('ggh-columns-legend')) { legend = document.createElement('div'); legend.className = 'ggh-columns-legend'; el.after(legend); }
    legend.innerHTML = `<span><span class="sw" style="background:${css('--ggh-seq-2')}"></span>เก็บเกี่ยวแล้ว (ถึงสิ้น${ymLabel(m)})</span><span><span class="sw" style="background:${css('--ggh-straw')}"></span>เดือนถัดไป</span><span><span class="sw" style="background:${css('--ggh-seq-3')}"></span>ล่วงหน้า</span>`;

    // Stacked: harvested-to-date vs remaining, each bar = planted total.
    const total = months.reduce((s, x) => s + x.areaRai, 0);
    let cum = 0;
    st.style.setProperty('--cols', String(months.length || 1));
    st.innerHTML = months.map((x, i) => {
      cum += x.areaRai;
      const h = total ? (cum / total) * 100 : 0;
      return `<div class="ggh-col ${x.month === m ? 'is-asof' : ''}" tabindex="0" data-i="${i}" aria-label="สิ้น${ymLabel(x.month, true)}: เก็บเกี่ยวแล้ว ${pct(cum, total)}%">
        <div class="ggh-stack"><i class="rem" style="height:${(100 - h).toFixed(1)}%"></i><i class="done" style="height:${h.toFixed(1)}%"></i></div>
        <span class="ggh-col-label">${ymLabel(x.month)}</span></div>`;
    }).join('');
    let c2 = 0;
    st.querySelectorAll('.ggh-col').forEach((col, i) => {
      c2 += months[i].areaRai;
      bindTip(col, `<strong>สิ้น${ymLabel(months[i].month, true)}</strong><br>เก็บเกี่ยวแล้ว ${fmt(c2)} ไร่ (${pct(c2, total)}%)<br>คงเหลือ ${fmt(total - c2)} ไร่`);
    });
    let leg = st.nextElementSibling;
    if (!leg || !leg.classList.contains('ggh-columns-legend')) { leg = document.createElement('div'); leg.className = 'ggh-columns-legend'; st.after(leg); }
    leg.innerHTML = `<span><span class="sw" style="background:${css('--ggh-seq-4')}"></span>เก็บเกี่ยวแล้วสะสม</span><span><span class="sw" style="background:${css('--ggh-seq-1')}"></span>คงเหลือ</span>`;
  }

  function renderTrend() {
    const wrap = $('dashTrendWrap'), el = $('dashTrend');
    if (!wrap || !el) return;
    const r = reports();
    const series = r ? (r.series || []).filter((x) => x.values && x.values.R31) : [];
    if (!r) { el.innerHTML = '<p class="ggh-district-empty ggh-trend-empty">ยังโหลดข้อมูลรายงานอำเภอไม่ได้</p>'; return; }
    const vals = series.map((x) => Number(x.values.R31.cumulative) || 0);
    if (!vals.some(Boolean)) {
      el.innerHTML = `<p class="ggh-district-empty ggh-trend-empty">ยังไม่มีอำเภอส่งรายงานที่มีตัวเลขไถกลบ/ย่อยสลาย กราฟจะแสดงเมื่ออำเภอส่งรายงานครั้งแรก${r.round && r.round.due ? ` (รอบ${esc(r.round.label)} ครบกำหนด ${esc(dateRange(r.round.due))})` : ''}</p>`;
      return;
    }
    const max = Math.max(...vals);
    columns(el, series.map((x, i) => ({
      value: vals[i], label: x.round === 0 ? 'ยกมา' : `ครั้งที่ ${x.round}`, aria: `${x.label}: ${fmt(vals[i])} ไร่`,
      cls: i === series.length - 1 ? 'is-current' : '', showValue: i === series.length - 1 || vals[i] === max,
      tip: `<strong>${esc(x.label)}</strong>${x.start ? `<br>${esc(dateRange(x.start, x.end))}` : ''}<br>สะสม ${fmt(vals[i])} ไร่<br>อำเภอที่รายงาน ${fmt(x.reported)}`
    })), { short: (v) => fmt(v) });
  }

  function renderHarvest() {
    const el = $('dashHarvest'); const s = state.summary;
    if (!el || !s) return;
    const months = s.harvestByMonth || [];
    const max = Math.max(0, ...months.map((x) => x.areaRai));
    const cur = months.findIndex((x) => x.isCurrent);
    columns(el, months.map((x, i) => ({
      value: x.areaRai, label: keyLabel(x.month), aria: `${keyLabel(x.month, true)}: ${fmt(x.areaRai, 1)} ไร่`,
      cls: i < cur ? 'is-past' : (i === cur || i === cur + 1) ? 'is-current' : '', showValue: x.areaRai && (x.areaRai === max || i === cur || i === cur + 1),
      tip: `<strong>${keyLabel(x.month, true)}</strong><br>${fmt(x.areaRai, 1)} ไร่, ${fmt(x.plots)} แปลง`
    })), { short: (v) => fmt(v) });
  }

  function renderMaterials() {
    const el = $('dashMaterials'); const s = state.summary;
    if (!el || !s) return;
    const list = s.byMaterial || [];
    const max = Math.max(0, ...list.map((m) => m.areaRai));
    el.innerHTML = list.length ? list.map((m) => `<div class="ggh-bar-row" tabindex="0" data-m="${esc(m.material)}">
        <span class="ggh-bar-name">${esc(m.material)}</span>
        <span class="ggh-bar-meta">${fmt(m.areaRai, 1)} ไร่, ${m.buyers ? `จุดรับซื้อ ${fmt(m.buyers)}` : 'ยังไม่มีจุดรับซื้อ'}</span>
        <div class="ggh-bar-track"><div class="ggh-bar-fill" style="width:${max ? (m.areaRai / max * 100).toFixed(1) : 0}%"></div></div></div>`).join('')
      : '<p class="ggh-district-empty">ยังไม่มีข้อมูล</p>';
    el.querySelectorAll('.ggh-bar-row').forEach((row) => {
      const m = list.find((x) => x.material === row.dataset.m);
      bindTip(row, `<strong>${esc(m.material)}</strong><br>${fmt(m.plots)} แปลง, ${fmt(m.areaRai, 1)} ไร่<br>รับซื้อได้ ${fmt(m.capacityTonPerDay, 1)} ตัน/วัน` + (m.avgBuyerPriceBahtPerRai !== null ? `<br>ราคาเฉลี่ย ${fmt(m.avgBuyerPriceBahtPerRai)} บาท/ไร่` : ''));
    });
    $('dashResidueNote').textContent = (s.notes && s.notes.residue) || '';
  }

  function renderGoals() {
    const wrap = $('dashGoalsWrap'), list = $('dashGoals'), s = state.summary;
    if (!wrap || !list || !s) return;
    const goals = s.goals || [];
    wrap.classList.toggle('hidden', !goals.length);
    list.innerHTML = goals.map((g) => `<li><strong>${esc(g.icon)} ${esc(g.title)}</strong>${g.description ? `<span>${esc(g.description)}</span>` : ''}</li>`).join('');
  }

  function renderSourceNote() {
    const el = $('dashSourceNote'); if (!el) return;
    const base = 'ภาพรวมรายอำเภอ ไม่แสดงข้อมูลส่วนบุคคล';
    const src = {
      overview: 'ข้อมูลจากทะเบียนเกษตรกร ระบบรายงานอำเภอ (KPP Smart Agri-Materials) และ Green Gain Hub',
      crops: `${(state.summary?.crops?.source) || 'ทะเบียนเกษตรกร'} พื้นที่เก็บเกี่ยวเป็นค่าคาดการณ์ตามวันที่คาดว่าจะเก็บเกี่ยว`,
      reports: 'KPP Smart Agri-Materials นับเฉพาะรายงานที่ส่งแล้วหรือตรวจรับแล้ว',
      market: 'แปลงและจุดรับซื้อที่ลงทะเบียนใน Green Gain Hub เข้าสู่ระบบเพื่อดูคู่ค้าบนแผนที่'
    }[state.tab];
    el.textContent = `${base} ที่มา: ${src}`;
  }

  /* ---------------- tabs ---------------- */
  function setTab(tab, focus) {
    if (!TABS.includes(tab)) tab = 'overview';
    state.tab = tab;
    $('loginPage').dataset.tab = tab;
    document.querySelectorAll('.ggh-tabs [data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    try { history.replaceState(null, '', tab === 'overview' ? location.pathname + location.search : '#' + tab); } catch (e) { /* ignore */ }
    renderAll();
    if (state.map) setTimeout(() => state.map.invalidateSize(), 30);
  }
  function bindTabs() {
    const btns = [...document.querySelectorAll('.ggh-tabs [data-tab]')];
    btns.forEach((b, i) => {
      b.addEventListener('click', () => setTab(b.dataset.tab));
      b.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        setTab(btns[(i + d + btns.length) % btns.length].dataset.tab, true);
      });
    });
    const sel = $('dashAsOf');
    if (sel) sel.addEventListener('change', () => { state.asOf = Number(sel.value); renderAll(); });
  }

  function renderAll() {
    renderCropToolbar();
    renderKpis();
    renderMetrics();
    renderMap();
    renderDistrictPanel();
    renderSourceNote();
    if (state.tab === 'overview' || state.tab === 'crops') renderCropCharts();
    if (state.tab === 'reports') renderTrend();
    if (state.tab === 'market') { renderHarvest(); renderMaterials(); }
    if (state.tab === 'overview') renderGoals();
    renderTable();
  }

  function setStatus(text, isError, retry) {
    const el = $('dashUpdated'); if (!el) return;
    el.classList.toggle('is-error', !!isError);
    el.textContent = text;
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ggh-retry'; b.textContent = 'ลองใหม่';
      b.addEventListener('click', refresh);
      el.appendChild(b);
    }
  }

  function bindSearch() {
    const search = $('dashSearch'); if (!search) return;
    const go = () => {
      const q = search.value.trim().replace(/^อ(ำเภอ|\.)\s*/, '');
      if (!q || !state.geo) return;
      const f = state.geo.features.find((x) => x.properties.name === q) ||
        state.geo.features.find((x) => x.properties.name.includes(q) || String(x.properties.name_en).toLowerCase().includes(q.toLowerCase()));
      if (f) { state.selected = null; selectDistrict(f.properties.code, true); }
    };
    search.addEventListener('change', go);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  /* Wider layout only while the landing page is visible; the logged-in app keeps its width. */
  function watchLanding() {
    const page = $('loginPage'); if (!page) return;
    const sync = () => {
      const visible = !page.classList.contains('hidden');
      document.body.classList.toggle('ggh-landing-on', visible);
      if (visible && state.map) setTimeout(() => state.map.invalidateSize(), 50);
    };
    new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  function refresh() {
    setStatus('กำลังโหลดข้อมูล…');
    return loadSummary().then((data) => {
      state.summary = data; writeCache(data); renderAll();
      setStatus(`ข้อมูล ณ ${timeLabel(data.generatedAt)} น.`);
    }).catch((err) => {
      if (state.summary) setStatus(`แสดงข้อมูลที่บันทึกไว้ (${timeLabel(state.summary.generatedAt)} น.) โหลดข้อมูลใหม่ไม่สำเร็จ`, true, true);
      else setStatus('โหลดข้อมูลสรุปไม่สำเร็จ: ' + err.message, true, true);
      console.warn('[GGH dashboard]', err);
    });
  }

  function init() {
    if (!$('dashMap')) return;
    watchLanding(); bindTabs(); bindSearch();
    const cached = readCache();
    if (cached && cached.totals) state.summary = cached;
    const hashTab = (location.hash || '').replace('#', '');
    setTab(TABS.includes(hashTab) ? hashTab : 'overview');
    loadGeo().then((geo) => {
      state.geo = geo;
      $('dashDistrictList').innerHTML = geo.features.map((f) => `<option value="${esc(f.properties.name)}">`).join('');
      renderAll();
    }).catch((err) => console.warn('[GGH dashboard] boundaries', err));
    refresh();
    window.GGH_DASHBOARD = { refresh, state, setTab };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
