/* Green Gain Hub 1.5.0 — public landing dashboard.
 * Reads the aggregate-only endpoint  ?api=v1&endpoint=summary  of the GGH
 * backend. That response carries two data sets:
 *   - GGH market totals (plots for sale, buyers) and
 *   - data.reports: KPP Smart Agri-Materials district reports, proxied by
 *     the backend so the Smart Agri API key never reaches the browser.
 * District boundaries come from assets/kpp-districts.geojson. No personal data
 * is requested or rendered here.
 */
(function () {
  'use strict';

  const cfg = window.GGH_CONFIG || {};
  const API_BASE = cfg.SUMMARY_API_URL || cfg.SHEETS_API_URL || '';
  const API_KEY = cfg.SUMMARY_API_KEY || '';
  const TIMEOUT = Number(cfg.REQUEST_TIMEOUT_MS) || 30000;
  const CACHE_KEY = 'ggh_summary_v1';
  const GEO_URL = 'assets/kpp-districts.geojson?v=1.5.0';
  const SEQ = ['--ggh-seq-1', '--ggh-seq-2', '--ggh-seq-3', '--ggh-seq-4', '--ggh-seq-5'];
  const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const METRICS = {
    R31: { label: 'ไถกลบตอซัง/ใช้สารย่อยสลาย (ไร่)', unit: 'ไร่', digits: 0, source: 'reports' },
    R30: { label: 'แปรรูปวัสดุเพิ่มมูลค่า (หมู่บ้าน/ชุมชน)', unit: 'หมู่บ้าน/ชุมชน', digits: 0, source: 'reports' },
    R29: { label: 'ส่งเสริมแปรรูปแทนการเผา (ครั้ง)', unit: 'ครั้ง', digits: 0, source: 'reports' },
    areaRai: { label: 'แปลงพร้อมขาย (ไร่)', unit: 'ไร่', digits: 1 },
    plots: { label: 'จำนวนแปลง', unit: 'แปลง', digits: 0 },
    buyers: { label: 'จุดรับซื้อ', unit: 'จุด', digits: 0 },
    capacityTonPerDay: { label: 'รับซื้อได้ (ตัน/วัน)', unit: 'ตัน/วัน', digits: 1 }
  };
  const REPORT_STATUS = {
    accepted: 'ตรวจรับแล้ว', submitted: 'ส่งแล้ว', draft: 'ยังไม่ส่ง (ร่าง)', returned: 'ส่งกลับแก้ไข', none: 'ยังไม่รายงาน'
  };

  const state = { summary: null, geo: null, metric: 'areaRai', metricChosen: false, selected: null, map: null, layer: null, layers: {} };
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

  function fmt(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits ?? 0, minimumFractionDigits: 0 }).format(n);
  }
  function compact(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    if (Math.abs(n) >= 1e6) return fmt(n / 1e6, 1) + ' ล้าน';
    return fmt(n, 0);
  }
  function monthLabel(key, long) {
    const [y, m] = key.split('-').map(Number);
    const be = y + 543;
    return long ? `${THAI_MONTHS[m - 1]} ${be}` : `${THAI_MONTHS_SHORT[m - 1]} ${String(be).slice(-2)}`;
  }
  function timeLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- data ---------------- */

  function summaryUrl(extra) {
    const q = new URLSearchParams({ api: 'v1', endpoint: 'summary' });
    if (API_KEY) q.set('key', API_KEY);
    Object.entries(extra || {}).forEach(([k, v]) => q.set(k, v));
    return API_BASE + (API_BASE.includes('?') ? '&' : '?') + q.toString();
  }

  function viaFetch() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetch(summaryUrl(), { signal: ctrl.signal, redirect: 'follow' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(timer));
  }

  function viaJsonp() {
    return new Promise((resolve, reject) => {
      const cb = '__ggh_sum_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const timer = setTimeout(() => { done(); reject(new Error('API timeout')); }, TIMEOUT);
      function done() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (payload) => { done(); resolve(payload); };
      s.src = summaryUrl({ callback: cb });
      s.onerror = () => { done(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }

  function loadSummary() {
    if (!API_BASE || API_BASE.includes('PUT_YOUR')) return Promise.reject(new Error('ยังไม่ได้กำหนด SUMMARY_API_URL ใน assets/config.js'));
    return viaFetch().catch(() => viaJsonp()).then((payload) => {
      if (!payload || payload.ok === false) {
        const msg = payload && payload.error || 'API error';
        throw new Error(/Invalid action/i.test(msg) ? 'Apps Script ยังเป็นรุ่นเก่า กรุณา Deploy รุ่น 1.5.0' : msg);
      }
      if (!payload.data || !payload.data.totals) throw new Error('API ส่งข้อมูลสรุปไม่ครบ');
      return payload.data;
    });
  }

  function readCache() {
    try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  function loadGeo() {
    return fetch(GEO_URL).then((r) => { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); });
  }

  /* ---------------- tooltip ---------------- */

  function showTip(html, x, y) {
    const tip = $('dashTooltip');
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (top + h > window.innerHeight - 8) top = y - h - pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { const tip = $('dashTooltip'); if (tip) tip.hidden = true; }
  function bindTip(el, html) {
    el.addEventListener('mousemove', (e) => showTip(html, e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(html, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', hideTip);
  }

  /* ---------------- helpers over the summary ---------------- */

  function reports() {
    const r = state.summary && state.summary.reports;
    return r && r.ok ? r : null;
  }
  function reportFor(code) {
    const r = reports();
    return r ? (r.byDistrict || []).find((d) => d.code === code) || null : null;
  }
  function reportValue(code, id) {
    const d = reportFor(code);
    const x = d && d.items && d.items[id];
    return x && x.cumulative !== null && x.cumulative !== undefined ? Number(x.cumulative) : null;
  }
  function reportItem(id) {
    const r = reports();
    return r ? (r.items || []).find((x) => x.id === id) || null : null;
  }
  function valueFor(code, metric) {
    return METRICS[metric] && METRICS[metric].source === 'reports' ? reportValue(code, metric) : Number(districtStats(code)[metric]) || 0;
  }
  function statusChip(status) {
    const st = REPORT_STATUS[status] ? status : 'none';
    return `<span class="ggh-status s-${st}">${esc(REPORT_STATUS[st])}</span>`;
  }

  function districtStats(code) {
    const list = (state.summary && state.summary.byDistrict) || [];
    return list.find((d) => d.code === code) || { code, plots: 0, farmers: 0, areaRai: 0, buyers: 0, capacityTonPerDay: 0, residueTon: null, materials: [] };
  }
  function breaks(metric) {
    const codes = state.geo ? state.geo.features.map((f) => f.properties.code) : [];
    const values = codes.map((c) => Number(valueFor(c, metric)) || 0);
    const max = Math.max(0, ...values);
    if (max <= 0) return [];
    const step = max / SEQ.length;
    return SEQ.map((_, i) => step * (i + 1));
  }
  function colorFor(value, br) {
    if (!value || !br.length) return css('--ggh-zero');
    for (let i = 0; i < br.length; i++) if (value <= br[i] + 1e-9) return css(SEQ[i]);
    return css(SEQ[SEQ.length - 1]);
  }

  /* ---------------- render: KPIs ---------------- */

  function renderKpis(s) {
    const t = s.totals;
    const set = (k, v) => { const el = document.querySelector(`[data-kpi="${k}"]`); if (el) { el.textContent = v; el.classList.remove('ggh-skeleton'); } };
    const sub = (k, v) => { const el = document.querySelector(`[data-kpi-sub="${k}"]`); if (el) el.textContent = v; };
    set('farmerPlots', fmt(t.farmerPlots));
    sub('farmers', `จากเกษตรกร ${fmt(t.farmers)} ราย`);
    set('areaRai', fmt(t.areaRai, 1));
    sub('districts', `ครอบคลุม ${fmt(t.districtsCovered)} จาก ${fmt(t.districtsTotal)} อำเภอ`);
    set('upcoming', fmt(s.upcomingHarvest.days30.areaRai, 1));
    sub('upcoming', `${fmt(s.upcomingHarvest.days30.plots)} แปลง, ใน 60 วัน ${fmt(s.upcomingHarvest.days60.areaRai, 1)} ไร่`);
    set('buyers', fmt(t.buyers));
    sub('capacity', `รับได้รวม ${fmt(t.capacityTonPerDay, 1)} ตัน/วัน`);
    set('price', t.avgBuyerPriceBahtPerRai === null ? '–' : fmt(t.avgBuyerPriceBahtPerRai, 0));
    sub('value', t.potentialValueBaht === null ? 'ยังไม่มีราคาอ้างอิง' : `มูลค่าศักยภาพ ≈ ${compact(t.potentialValueBaht)} บาท`);
  }

  function renderReportKpis() {
    const group = $('dashReportKpis');
    if (!group) return;
    const r = reports();
    const raw = state.summary && state.summary.reports;
    group.classList.toggle('is-unavailable', !r);
    const set = (k, v) => { const el = document.querySelector(`[data-rkpi="${k}"]`); if (el) { el.textContent = v; el.classList.remove('ggh-skeleton'); } };
    const sub = (k, v) => { const el = document.querySelector(`[data-rkpi-sub="${k}"]`); if (el) el.textContent = v; };
    const meta = $('dashReportRound');
    if (!r) {
      ['R31', 'R30', 'R29', 'reported'].forEach((k) => { set(k, '–'); sub(k, ''); });
      if (meta) meta.textContent = raw && raw.configured === false ? 'กำลังเชื่อมต่อระบบรายงาน' : 'ยังโหลดข้อมูลรายงานไม่ได้';
      return;
    }
    ['R31', 'R30', 'R29'].forEach((id) => {
      const it = reportItem(id);
      set(id, it && it.cumulative !== null ? fmt(it.cumulative, 0) : '–');
      sub(id, it ? (it.week !== null ? `ครั้งล่าสุด +${fmt(it.week, 0)}` : 'ครั้งล่าสุดยังไม่มีตัวเลข') + `, ${fmt(it.districtsYes)} อำเภอดำเนินการ` : '');
    });
    set('reported', `${fmt(r.reportedCount)}/${fmt(r.districtsTotal)}`);
    const sc = r.statusCounts || {};
    sub('reported', `ตรวจรับแล้ว ${fmt(sc.accepted || 0)}, รอตรวจ ${fmt(sc.submitted || 0)}`);
    if (meta) meta.textContent = r.round && r.round.round ? `${r.round.label || 'ครั้งที่ ' + r.round.round}${r.round.start ? ` (${dateRange(r.round.start, r.round.end)})` : ''}` : '';
  }

  function dateRange(a, b) {
    const f = (x) => { const d = new Date(x + 'T00:00:00'); return isNaN(d) ? x : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
    return b ? `${f(a)} – ${f(b)}` : f(a);
  }

  function renderTrend() {
    const wrap = $('dashTrendWrap'), el = $('dashTrend');
    if (!wrap || !el) return;
    const r = reports();
    const series = r ? (r.series || []).filter((x) => x.values && x.values.R31) : [];
    wrap.classList.toggle('hidden', !series.length);
    if (!series.length) return;
    const vals = series.map((x) => Number(x.values.R31.cumulative) || 0);
    const max = Math.max(0, ...vals);
    el.style.setProperty('--cols', String(series.length));
    el.innerHTML = series.map((x, i) => {
      const v = vals[i];
      const h = max ? (v / max) * 100 : 0;
      const last = i === series.length - 1;
      const label = x.round === 0 ? 'ยกมา' : `ครั้งที่ ${x.round}`;
      return `<div class="ggh-col ${last ? 'is-current' : ''} ${v ? '' : 'is-empty'}" tabindex="0" data-i="${i}" aria-label="${esc(x.label || label)}: ${fmt(v, 0)} ไร่">
        <div class="ggh-col-bar" style="height:${Math.max(v ? 3 : 1, h * 0.82).toFixed(1)}%"></div>
        ${v && (last || v === max) ? `<span class="ggh-col-value" style="bottom:calc(${(h * 0.82).toFixed(1)}% + 1.5rem)">${fmt(v, 0)}</span>` : ''}
        <span class="ggh-col-label">${esc(label)}</span></div>`;
    }).join('');
    el.querySelectorAll('.ggh-col').forEach((col) => {
      const x = series[Number(col.dataset.i)];
      bindTip(col, `<strong>${esc(x.label || ('ครั้งที่ ' + x.round))}</strong>${x.start ? `<br>${esc(dateRange(x.start, x.end))}` : ''}<br>สะสม ${fmt(x.values.R31.cumulative, 0)} ไร่` +
        (x.values.R31.week !== null ? `<br>ครั้งนี้ +${fmt(x.values.R31.week, 0)} ไร่` : '') + `<br>อำเภอที่รายงาน ${fmt(x.reported)}`);
    });
  }

  function renderSourceNote() {
    const el = $('dashSourceNote');
    if (!el) return;
    const r = reports();
    const base = 'แสดงเป็นภาพรวมรายอำเภอ ไม่แสดงชื่อ เบอร์โทร หรือตำแหน่งแปลง';
    el.textContent = r
      ? `${base} ข้อมูลรายงานจาก ${r.source && r.source.name || 'KPP Smart Agri-Materials'} นับเฉพาะรายงานที่ส่งแล้วหรือตรวจรับแล้ว ข้อมูลตลาดจาก Green Gain Hub`
      : `${base} เข้าสู่ระบบเพื่อดูคู่ค้าบนแผนที่`;
  }

  /* ---------------- render: map ---------------- */

  function ensureMap() {
    if (state.map || !window.L || !$('dashMap')) return state.map;
    state.map = L.map('dashMap', { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18, subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO · ขอบเขตอำเภอ: OpenGISData-Thailand (CC BY 4.0)'
    }).addTo(state.map);
    state.map.setView([16.3, 99.6], 9);
    return state.map;
  }

  function renderMap() {
    const map = ensureMap();
    if (!map || !state.geo) return;
    const br = breaks(state.metric);
    if (state.layer) { map.removeLayer(state.layer); state.layers = {}; }
    state.layer = L.geoJSON(state.geo, {
      style: (f) => ({
        color: '#ffffff', weight: 1.5, fillOpacity: 0.85,
        fillColor: colorFor(valueFor(f.properties.code, state.metric), br)
      }),
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
    renderLegend(br);
  }

  function districtTip(p) {
    const d = districtStats(p.code);
    const rep = reportFor(p.code);
    const r31 = reportValue(p.code, 'R31');
    const reportLine = reports() ? `<br>รายงาน: ${esc(REPORT_STATUS[rep && rep.status] || REPORT_STATUS.none)}${r31 !== null ? `, ไถกลบ/ย่อยสลาย ${fmt(r31, 0)} ไร่` : ''}` : '';
    return `<strong>อ.${esc(p.name)}</strong>${reportLine}<br>ตลาด: ${fmt(d.plots)} แปลง, ${fmt(d.areaRai, 1)} ไร่, จุดรับซื้อ ${fmt(d.buyers)}`;
  }

  function restyleSelection() {
    Object.entries(state.layers).forEach(([code, layer]) => {
      const on = code === state.selected;
      layer.setStyle({ weight: on ? 3.5 : 1.5, color: on ? css('--ggh-green-dark') : '#ffffff' });
      if (on) layer.bringToFront();
    });
  }

  function renderLegend(br) {
    const el = $('dashLegend');
    if (!el) return;
    const m = METRICS[state.metric];
    if (!br.length) { el.innerHTML = `<span><span class="sw" style="background:${css('--ggh-zero')}"></span>ยังไม่มีข้อมูล${esc(m.label)}</span>`; return; }
    let lo = 0;
    const items = br.map((hi, i) => {
      const txt = `${fmt(lo, m.digits)}–${fmt(hi, m.digits)}`;
      lo = hi;
      return `<span><span class="sw" style="background:${css(SEQ[i])}"></span>${txt}</span>`;
    });
    el.innerHTML = `<span>${esc(m.label)}:</span><span><span class="sw" style="background:${css('--ggh-zero')}"></span>ไม่มีข้อมูล</span>` + items.join('');
  }

  /* ---------------- render: district panel + table ---------------- */

  function selectDistrict(code, zoom) {
    state.selected = state.selected === code && !zoom ? null : code;
    restyleSelection();
    renderDistrictPanel();
    document.querySelectorAll('#dashTable tr').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.code === state.selected));
    if (zoom && state.selected && state.layers[code] && state.map) state.map.fitBounds(state.layers[code].getBounds(), { padding: [30, 30], maxZoom: 11 });
  }

  function districtName(code) {
    if (code === 'OTHER') return 'นอกเขต/ไม่ระบุพิกัด';
    const f = state.geo && state.geo.features.find((x) => x.properties.code === code);
    return f ? f.properties.name : code;
  }

  function renderDistrictPanel() {
    const el = $('dashDistrict');
    if (!el) return;
    if (!state.selected) {
      el.innerHTML = '<p class="ggh-district-empty">เลือกอำเภอบนแผนที่ หรือค้นหาชื่ออำเภอ เพื่อดูรายละเอียด</p>';
      return;
    }
    const d = districtStats(state.selected);
    const name = districtName(state.selected);
    const mats = (d.materials || []).map((m) => `<li><span>${esc(m.material)}</span><span>${fmt(m.areaRai, 1)} ไร่</span></li>`).join('');
    const rep = reportFor(state.selected);
    const repVal = (id) => { const v = reportValue(state.selected, id); return v === null ? '–' : fmt(v, 0); };
    const reportHtml = reports() && state.selected !== 'OTHER' ? `
      <h4><span>รายงานการจัดการเศษวัสดุ</span>${statusChip(rep && rep.status)}</h4>
      <dl>
        <div><dt>ไถกลบ/ย่อยสลาย (ไร่)</dt><dd>${repVal('R31')}</dd></div>
        <div><dt>แปรรูป (หมู่บ้าน/ชุมชน)</dt><dd>${repVal('R30')}</dd></div>
        <div><dt>ส่งเสริม (ครั้ง)</dt><dd>${repVal('R29')}</dd></div>
      </dl>
      <h4><span>ตลาด Green Gain Hub</span></h4>` : '';
    el.innerHTML = `
      <h3><span>${state.selected === 'OTHER' ? '' : 'อ.'}${esc(name)}</span><button type="button" data-clear>ล้างการเลือก</button></h3>
      ${reportHtml}
      <dl>
        <div><dt>แปลงพร้อมขาย</dt><dd>${fmt(d.plots)}</dd></div>
        <div><dt>พื้นที่ (ไร่)</dt><dd>${fmt(d.areaRai, 1)}</dd></div>
        <div><dt>เกษตรกร (ราย)</dt><dd>${fmt(d.farmers)}</dd></div>
        <div><dt>จุดรับซื้อ</dt><dd>${fmt(d.buyers)}</dd></div>
        <div><dt>รับซื้อได้ (ตัน/วัน)</dt><dd>${fmt(d.capacityTonPerDay, 1)}</dd></div>
        <div><dt>เศษวัสดุโดยประมาณ (ตัน)</dt><dd>${d.residueTon === null ? '–' : fmt(d.residueTon, 1)}</dd></div>
      </dl>
      ${mats ? `<ul>${mats}</ul>` : '<p class="ggh-district-empty" style="margin-top:.75rem">ยังไม่มีแปลงที่ลงทะเบียนในอำเภอนี้ เกษตรกรในพื้นที่ลงทะเบียนได้ฟรี</p>'}`;
    el.querySelector('[data-clear]').addEventListener('click', () => selectDistrict(state.selected, false));
  }

  function renderTable(s) {
    const body = $('dashTable');
    if (!body) return;
    const hasReports = !!reports();
    const codes = state.geo ? state.geo.features.map((f) => f.properties.code) : (s.byDistrict || []).map((d) => d.code).filter((c) => c !== 'OTHER');
    const other = (s.byDistrict || []).find((d) => d.code === 'OTHER');
    const rows = codes.map((code) => ({ code, name: districtName(code), g: districtStats(code), r31: reportValue(code, 'R31'), r30: reportValue(code, 'R30'), r29: reportValue(code, 'R29'), rep: reportFor(code) }));
    rows.sort((a, b) => (b.r31 || 0) - (a.r31 || 0) || b.g.areaRai - a.g.areaRai || b.g.buyers - a.g.buyers || String(a.name).localeCompare(String(b.name), 'th'));
    if (other) rows.push({ code: 'OTHER', name: other.name, g: other, r31: null, r30: null, r29: null, rep: null });
    const max31 = Math.max(0, ...rows.map((r) => r.r31 || 0));
    const dash = (v) => (v === null ? '–' : fmt(v, 0));
    body.innerHTML = rows.map((r) => {
      const pct = max31 ? Math.max(r.r31 ? 2 : 0, ((r.r31 || 0) / max31) * 100) : 0;
      const empty = !(r.r31 || r.r30 || r.r29 || r.g.plots || r.g.buyers);
      const cls = [empty ? 'is-zero' : '', r.code === 'OTHER' ? 'is-other' : '', r.code === state.selected ? 'is-selected' : ''].join(' ').trim();
      return `<tr tabindex="0" data-code="${esc(r.code)}" class="${cls}">
        <td>${esc(r.name)}</td><td>${hasReports && r.code !== 'OTHER' ? statusChip(r.rep && r.rep.status) : '–'}</td>
        <td class="num">${dash(r.r31)}</td><td><div class="ggh-inline-bar" style="width:${pct.toFixed(1)}%"></div></td>
        <td class="num">${dash(r.r30)}</td><td class="num">${dash(r.r29)}</td>
        <td class="num">${fmt(r.g.plots)}</td><td class="num">${fmt(r.g.areaRai, 1)}</td><td class="num">${fmt(r.g.buyers)}</td></tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr) => {
      const go = () => { selectDistrict(tr.dataset.code, tr.dataset.code !== 'OTHER'); if (window.innerWidth < 1024) $('dashDistrict').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  /* ---------------- render: charts ---------------- */

  function renderHarvest(s) {
    const el = $('dashHarvest');
    if (!el) return;
    const months = s.harvestByMonth || [];
    const max = Math.max(0, ...months.map((m) => m.areaRai));
    const currentIdx = months.findIndex((m) => m.isCurrent);
    el.innerHTML = months.map((m, i) => {
      const h = max ? (m.areaRai / max) * 100 : 0;
      const cls = ['ggh-col', i < currentIdx ? 'is-past' : '', i === currentIdx ? 'is-current' : '', i === currentIdx + 1 ? 'is-soon' : '', m.areaRai ? '' : 'is-empty'].join(' ').trim();
      const showValue = m.areaRai && (m.areaRai === max || i === currentIdx || i === currentIdx + 1);
      return `<div class="${cls}" tabindex="0" data-i="${i}" aria-label="${esc(monthLabel(m.month, true))}: ${fmt(m.areaRai, 1)} ไร่ ${fmt(m.plots)} แปลง">
        <div class="ggh-col-bar" style="height:${Math.max(m.areaRai ? 3 : 1, h * 0.82).toFixed(1)}%"></div>
        ${showValue ? `<span class="ggh-col-value" style="bottom:calc(${(h * 0.82).toFixed(1)}% + 1.5rem)">${fmt(m.areaRai, 0)}</span>` : ''}
        <span class="ggh-col-label">${esc(monthLabel(m.month))}</span></div>`;
    }).join('');
    el.querySelectorAll('.ggh-col').forEach((col) => {
      const m = months[Number(col.dataset.i)];
      bindTip(col, `<strong>${esc(monthLabel(m.month, true))}</strong><br>${fmt(m.areaRai, 1)} ไร่ · ${fmt(m.plots)} แปลง`);
    });
    let legend = el.nextElementSibling;
    if (!legend || !legend.classList.contains('ggh-columns-legend')) {
      legend = document.createElement('div');
      legend.className = 'ggh-columns-legend';
      el.after(legend);
    }
    legend.innerHTML = `<span><span class="sw" style="background:${css('--ggh-seq-2')}"></span>ผ่านมาแล้ว</span><span><span class="sw" style="background:${css('--ggh-straw')}"></span>เดือนนี้และเดือนหน้า</span><span><span class="sw" style="background:${css('--ggh-seq-3')}"></span>ล่วงหน้า</span>`;
  }

  function renderMaterials(s) {
    const el = $('dashMaterials');
    if (!el) return;
    const list = s.byMaterial || [];
    if (!list.length) { el.innerHTML = '<p class="ggh-district-empty">ยังไม่มีข้อมูล</p>'; return; }
    const max = Math.max(0, ...list.map((m) => m.areaRai));
    el.innerHTML = list.map((m) => {
      const pct = max ? (m.areaRai / max) * 100 : 0;
      const extra = [m.buyers ? `จุดรับซื้อ ${fmt(m.buyers)}` : 'ยังไม่มีจุดรับซื้อ', m.residueTon !== null ? `≈ ${fmt(m.residueTon, 0)} ตัน` : ''].filter(Boolean).join(' · ');
      return `<div class="ggh-bar-row" tabindex="0" data-m="${esc(m.material)}">
        <span class="ggh-bar-name">${esc(m.material)}</span>
        <span class="ggh-bar-meta">${fmt(m.areaRai, 1)} ไร่ · ${extra}</span>
        <div class="ggh-bar-track"><div class="ggh-bar-fill" style="width:${pct.toFixed(1)}%"></div></div></div>`;
    }).join('');
    el.querySelectorAll('.ggh-bar-row').forEach((row) => {
      const m = list.find((x) => x.material === row.dataset.m);
      bindTip(row, `<strong>${esc(m.material)}</strong><br>${fmt(m.plots)} แปลง · ${fmt(m.areaRai, 1)} ไร่<br>รับซื้อได้ ${fmt(m.capacityTonPerDay, 1)} ตัน/วัน` +
        (m.avgBuyerPriceBahtPerRai !== null ? `<br>ราคาเฉลี่ย ${fmt(m.avgBuyerPriceBahtPerRai, 0)} บาท/ไร่` : ''));
    });
    const note = $('dashResidueNote');
    if (note) note.textContent = (s.notes && s.notes.residue) || '';
  }

  function renderGoals(s) {
    const wrap = $('dashGoalsWrap'), list = $('dashGoals');
    if (!wrap || !list) return;
    const goals = s.goals || [];
    wrap.classList.toggle('hidden', !goals.length);
    list.innerHTML = goals.map((g) => `<li><strong>${esc(g.icon)} ${esc(g.title)}</strong>${g.description ? `<span>${esc(g.description)}</span>` : ''}</li>`).join('');
  }

  function renderSearch() {
    const dl = $('dashDistrictList');
    if (!dl || !state.geo) return;
    dl.innerHTML = state.geo.features.map((f) => `<option value="${esc(f.properties.name)}">`).join('');
  }

  function renderAll() {
    const s = state.summary;
    if (s) {
      chooseDefaultMetric();
      renderKpis(s);
      renderReportKpis();
      renderTrend();
      renderSourceNote();
      renderHarvest(s);
      renderMaterials(s);
      renderTable(s);
      renderGoals(s);
    }
    renderMap();
    renderDistrictPanel();
  }

  /* Report metrics are the headline once the Smart Agri link works; until then the market metric is shown. */
  function chooseDefaultMetric() {
    const ok = !!reports();
    document.querySelectorAll('.ggh-metric [data-source="reports"]').forEach((b) => { b.disabled = !ok; b.title = ok ? '' : 'ยังไม่มีข้อมูลรายงานจากอำเภอ'; });
    if (!state.metricChosen) state.metric = ok ? 'R31' : 'areaRai';
    if (!ok && METRICS[state.metric].source === 'reports') state.metric = 'areaRai';
    document.querySelectorAll('.ggh-metric [data-metric]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metric === state.metric)));
  }

  function setStatus(text, isError, retry) {
    const el = $('dashUpdated');
    if (!el) return;
    el.classList.toggle('is-error', !!isError);
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ' ลองใหม่';
      b.style.cssText = 'color:#1a7f37;font-weight:700;text-decoration:underline;margin-left:.35rem;min-height:auto';
      b.addEventListener('click', refresh);
      el.appendChild(b);
    }
  }

  /* ---------------- controls ---------------- */

  function bindControls() {
    document.querySelectorAll('.ggh-metric [data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        state.metric = btn.dataset.metric;
        state.metricChosen = true;
        document.querySelectorAll('.ggh-metric [data-metric]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
        renderMap();
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const all = [...document.querySelectorAll('.ggh-metric [data-metric]')];
        const next = all[(all.indexOf(btn) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        next.focus(); next.click();
      });
    });
    const search = $('dashSearch');
    if (search) {
      const go = () => {
        const q = search.value.trim().replace(/^อ(ำเภอ|\.)\s*/, '');
        if (!q || !state.geo) return;
        const f = state.geo.features.find((x) => x.properties.name === q) || state.geo.features.find((x) => x.properties.name.includes(q) || String(x.properties.name_en).toLowerCase().includes(q.toLowerCase()));
        if (f) { state.selected = null; selectDistrict(f.properties.code, true); }
      };
      search.addEventListener('change', go);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
  }

  /* Wider layout only while the landing page is visible; the logged-in app keeps its width. */
  function watchLanding() {
    const page = $('loginPage');
    if (!page) return;
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
      state.summary = data;
      writeCache(data);
      renderAll();
      setStatus(`ข้อมูล ณ ${timeLabel(data.generatedAt)} น.`);
    }).catch((err) => {
      if (state.summary) {
        setStatus(`แสดงข้อมูลล่าสุดที่บันทึกไว้ (${timeLabel(state.summary.generatedAt)} น.) — โหลดข้อมูลใหม่ไม่สำเร็จ`, true, true);
      } else {
        setStatus('โหลดข้อมูลสรุปไม่สำเร็จ: ' + err.message, true, true);
        document.querySelectorAll('[data-kpi], [data-rkpi]').forEach((el) => el.classList.remove('ggh-skeleton'));
      }
      console.warn('[GGH dashboard]', err);
    });
  }

  function init() {
    if (!$('dashMap')) return;
    watchLanding();
    bindControls();
    document.querySelectorAll('[data-kpi], [data-rkpi]').forEach((el) => el.classList.add('ggh-skeleton'));
    const cached = readCache();
    if (cached && cached.totals) { state.summary = cached; }
    loadGeo().then((geo) => { state.geo = geo; renderSearch(); renderAll(); })
      .catch((err) => console.warn('[GGH dashboard] boundaries', err));
    if (state.summary) renderAll();
    refresh();
    window.GGH_DASHBOARD = { refresh, state };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
