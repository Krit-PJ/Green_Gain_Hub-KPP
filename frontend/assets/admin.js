/* Green Gain Hub 4.2.0 — officers' page: Admin (one province) and Super Admin (all provinces).
   API: POST text/plain {method, args, token} to the same Apps Script web app (no cookies, no CORS preflight).
   Reports print on A4 landscape with the Agri-Risk Map Burning layout: header · map + legend + KPIs | full table · footer. */
(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const API = cfg.SHEETS_API_URL || '';
  const GEO = cfg.GEO_BASE || 'geo/';
  const TOKEN_KEY = 'ggh_admin_token';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? (v === '' || v === null || v === undefined ? '–' : esc(v)) : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d === undefined ? 2 : d }));
  const state = { token: sessionStorage.getItem(TOKEN_KEY) || '', me: null, province: '', provinces: [], view: 'overview', catalog: null, report: null };

  /* ---------------- API ---------------- */
  async function api(method, arg) {
    if (!API) throw new Error('ยังไม่ได้ตั้งค่า SHEETS_API_URL');
    let res;
    try {
      res = await fetch(API, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ method, args: arg === undefined ? [] : [arg], token: state.token }) });
    } catch (err) { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
    let data; try { data = await res.json(); } catch (err) { throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาลองใหม่'); }
    if (!data.ok) {
      if (/ADMIN_SESSION_EXPIRED|ถูกระงับหรือถูกลบ/.test(data.error || '')) { signOut(true); throw new Error('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่'); }
      throw new Error(data.error || 'ทำรายการไม่สำเร็จ');
    }
    return data.result;
  }
  function msg(id, text, ok) { const el = $(id); if (!el) return; el.textContent = text || ''; el.classList.toggle('is-ok', !!ok); }
  async function busy(btn, label, fn) {
    const old = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.textContent = label; }
    try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  }

  /* ---------------- provinces (boundary index, same origin) ---------------- */
  let provIndex = null;
  async function provinceIndex() {
    if (provIndex) return provIndex;
    try { const r = await fetch(GEO + 'provinces.json', { cache: 'force-cache' }); provIndex = (await r.json()).provinces || []; }
    catch (err) { provIndex = [{ code: '62', name: 'กำแพงเพชร' }]; }
    return provIndex;
  }
  async function fillProvinceSelect(sel, opts) {
    opts = opts || {};
    const list = (await provinceIndex()).map((p) => ({ code: String(p.code), name: String(p.name) })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const only = opts.only ? list.filter((p) => p.code === opts.only) : list;
    sel.innerHTML = (opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : '') + (opts.all ? '<option value="ALL">ทุกจังหวัด (สรุปรายจังหวัด)</option>' : '') +
      only.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('');
    if (opts.value) sel.value = opts.value;
    return list;
  }

  /* ---------------- auth ---------------- */
  function authTab(t) {
    document.querySelectorAll('[data-auth]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === t)));
    document.querySelectorAll('[data-authpanel]').forEach((f) => f.classList.toggle('hidden', f.dataset.authpanel !== t));
    if (t === 'register') fillProvinceSelect($('adRegForm').provinceCode, { placeholder: 'เลือกจังหวัด' });
  }
  document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => { authTab(b.dataset.auth); history.replaceState(null, '', '#' + b.dataset.auth); }));

  $('adLoginForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.username.value.trim() || !f.password.value) return msg('adLoginMsg', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    msg('adLoginMsg', '');
    busy(f.querySelector('[type=submit]'), 'กำลังเข้าสู่ระบบ…', async () => {
      try {
        const r = await api('adminLoginServer', { username: f.username.value.trim(), password: f.password.value });
        state.token = r.token; sessionStorage.setItem(TOKEN_KEY, r.token); f.reset(); start(r);
      } catch (err) { msg('adLoginMsg', err.message); }
    });
  });
  $('adRegForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    const miss = ['name', 'agency', 'provinceCode', 'phone', 'username', 'password'].filter((k) => !String(f[k].value).trim());
    if (miss.length) return msg('adRegMsg', 'กรุณากรอกข้อมูลให้ครบทุกช่อง');
    if (f.password.value !== f.password2.value) return msg('adRegMsg', 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    msg('adRegMsg', '');
    busy(f.querySelector('[type=submit]'), 'กำลังส่งคำขอ…', async () => {
      try {
        const r = await api('adminRegisterServer', { name: f.name.value, agency: f.agency.value, provinceCode: f.provinceCode.value, phone: f.phone.value.replace(/\D/g, ''),
          username: f.username.value.trim().toLowerCase(), password: f.password.value });
        f.reset(); authTab('login'); msg('adLoginMsg', r.message, true);
      } catch (err) { msg('adRegMsg', err.message); }
    });
  });
  $('adLogout').addEventListener('click', async () => { try { await api('adminLogoutServer'); } catch (err) { /* ignore */ } signOut(false); });
  function signOut(expired) {
    state.token = ''; state.me = null; sessionStorage.removeItem(TOKEN_KEY);
    $('adApp').classList.add('hidden'); $('adMe').classList.add('hidden'); $('adAuth').classList.remove('hidden');
    authTab('login'); if (expired) msg('adLoginMsg', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  }

  /* ---------------- app ---------------- */
  const isSuper = () => state.me && state.me.role === 'super';
  async function start(me) {
    state.me = me;
    $('adAuth').classList.add('hidden'); $('adApp').classList.remove('hidden'); $('adMe').classList.remove('hidden');
    $('adMeName').textContent = me.name; $('adMeAvatar').textContent = initials(me.name); greet();
    $('adMeRole').textContent = me.roleLabel + (me.provinceName ? ' · จ.' + me.provinceName : ' · ทุกจังหวัด');
    document.querySelectorAll('[data-super]').forEach((el) => el.classList.toggle('hidden', !isSuper()));
    state.province = isSuper() ? (sessionStorage.getItem('ggh_admin_prov') || '62') : me.province;
    await fillProvinceSelect($('adProvince'), { only: isSuper() ? '' : me.province, value: state.province });
    $('adProvince').disabled = !isSuper();
    $('adScopeNote').textContent = isSuper() ? 'Super Admin เลือกจังหวัดที่ต้องการจัดการได้' : 'Admin จัดการได้เฉพาะจังหวัดที่ลงทะเบียน';
    show(location.hash.replace('#', '') || 'overview');
  }
  // 4.2.0: initials avatar, time-of-day greeting with the Thai date
  function initials(name) {
    const parts = String(name || '').replace(/^(นาย|นางสาว|นาง|น\.ส\.)\s*/, '').trim().split(/\s+/).filter(Boolean);
    return (parts.map((p) => Array.from(p)[0]).join('').slice(0, 2) || '?').toUpperCase();
  }
  function greet() {
    const h = new Date().getHours();
    const part = h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
    $('adHello').textContent = `${part}, ${(state.me && state.me.name) || ''}`;
    $('adToday').textContent = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  $('adProvince').addEventListener('change', (e) => { state.province = e.target.value; sessionStorage.setItem('ggh_admin_prov', state.province); show(state.view); });
  document.querySelectorAll('.ad-nav [data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  const LOADERS = { overview: loadOverview, users: loadUsers, farmers: () => loadRecords('farmers'), buyers: () => loadRecords('buyers'),
    reports: loadReports, admins: loadAdmins, settings: loadRule, log: loadLog, account: loadAccount };
  function show(view) {
    if (!LOADERS[view] || (['admins', 'settings', 'log'].indexOf(view) >= 0 && !isSuper())) view = 'overview';
    state.view = view; history.replaceState(null, '', '#' + view);
    document.querySelectorAll('.ad-nav [data-view]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.view === view));
    document.querySelectorAll('.ad-nav [data-view][aria-current]').forEach((b) => b.setAttribute('aria-current', 'page'));
    document.querySelectorAll('[data-panel]').forEach((p) => { const on = p.dataset.panel === view; p.classList.toggle('hidden', !on); p.classList.toggle('is-enter', on); });
    const name = ($('adProvince').selectedOptions[0] || {}).textContent || '';
    document.querySelectorAll('[data-scope-name]').forEach((el) => { el.textContent = name; });
    $('adProvince').closest('.ad-scopebar').classList.toggle('hidden', ['reports', 'admins', 'settings', 'log', 'account'].indexOf(view) >= 0);
    LOADERS[view]().catch((err) => fail(view, err));
  }
  function fail(view, err) {
    const box = document.querySelector(`[data-panel="${view}"] .ad-tablewrap`) || document.querySelector(`[data-panel="${view}"]`);
    if (box) box.insertAdjacentHTML('afterbegin', `<p class="ad-msg" role="alert">${esc(err.message)}</p>`);
  }
  const loading = (id) => { $(id).innerHTML = '<p class="ad-more">กำลังโหลด…</p>'; };
  function table(cols, rows, opts) {
    opts = opts || {};
    const head = cols.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
    const body = rows.length ? rows.map((r) => `<tr>${cols.map((c) => `<td${c.num ? ' class="num"' : ''}>${c.html ? c.html(r) : c.num ? fmt(r[c.key], c.d) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
      : `<tr><td class="ad-empty" colspan="${cols.length}">${esc(opts.empty || 'ไม่มีข้อมูล')}</td></tr>`;
    const foot = opts.totals ? `<tfoot><tr>${cols.map((c) => `<td${c.num ? ' class="num"' : ''}>${opts.totals[c.key] === undefined ? '' : c.num ? fmt(opts.totals[c.key], c.d) : esc(opts.totals[c.key])}</td>`).join('')}</tr></tfoot>` : '';
    return `<table class="ad-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>` + (opts.more ? `<p class="ad-more">${esc(opts.more)}</p>` : '');
  }

  /* overview */
  async function loadOverview() {
    $('adKpis').innerHTML = '<p class="ad-more">กำลังโหลด…</p>'; loading('adOverviewTable');
    const r = await api('adminOverviewServer', { province: state.province });
    const x = r.summary;
    const k = (icon, v, unit, label, kind) => `<div class="ad-kpi"><span class="ad-kpi-ic" aria-hidden="true"><i class="fa-solid ${icon}"></i></span><div><b>${fmt(v, 0)} <small>${unit}</small></b><span>${label}<em class="${kind === 'est' ? 'is-est' : 'is-fact'}">${kind === 'est' ? 'ประมาณการ' : 'ข้อมูลจริง'}</em></span></div></div>`;
    $('adKpis').innerHTML = k('fa-user', x.usersFarmers, 'ราย', 'เกษตรกรที่ลงทะเบียน') + k('fa-store', x.usersBuyers, 'ราย', 'ผู้รับซื้อที่ลงทะเบียน') + k('fa-map-location-dot', x.plots, 'แปลง', 'แปลงบนตลาดวันนี้') +
      k('fa-vector-square', x.areaRai, 'ไร่', 'พื้นที่ประกาศขาย') + k('fa-weight-hanging', x.ton, 'ตัน', 'ชีวมวลที่คาดว่าจะได้', 'est') + k('fa-truck', x.buyers, 'จุด', 'จุดรับซื้อที่เปิดรับ') +
      k('fa-coins', x.potentialBaht, 'บาท', 'มูลค่าที่เป็นไปได้', 'est') + k('fa-hand-holding-dollar', x.salesBaht, 'บาท', 'รายได้จากการขายจริง');
    chartData = { h: r.harvest || [], m: r.materials || [] }; drawHarvest(chartData.h); drawMaterials(chartData.m);
    const pend = r.pendingAdmins || 0;
    $('adPendingBadge').textContent = pend; $('adPendingBadge').classList.toggle('hidden', !pend);
    $('adPendingAlert').classList.toggle('hidden', !pend);
    if (pend) $('adPendingAlert').innerHTML = `<i class="fa-solid fa-bell" aria-hidden="true"></i> มีคำขอเป็น Admin รออนุมัติ ${pend} รายการ — <a href="#admins" data-go="admins">ไปที่หน้าเจ้าหน้าที่</a>`;
    $('adOverviewTable').innerHTML = table([{ key: 'name', label: 'อำเภอ' }, { key: 'farmers', label: 'เกษตรกรผู้ขาย (ราย)', num: 1 }, { key: 'plots', label: 'แปลง', num: 1 },
      { key: 'areaRai', label: 'พื้นที่ (ไร่)', num: 1, d: 0 }, { key: 'ton', label: 'ชีวมวล ประมาณการ (ตัน)', num: 1, d: 0 }, { key: 'buyers', label: 'ผู้รับซื้อ (จุด)', num: 1 }, { key: 'salesBaht', label: 'รายได้จริง (บาท)', num: 1, d: 0 }],
    r.areas, { empty: 'ยังไม่มีแปลงประกาศขายหรือจุดรับซื้อในจังหวัดนี้' });
  }
  /* 4.2.0 charts — one series each, single hue, SVG with a hover/focus tooltip per mark; the district table stays the table view */
  const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthText = (m) => { if (m === 'done') return 'เลยวันเก็บ'; if (m === 'none') return 'ไม่ระบุ'; const [y, mm] = String(m).split('-'); return mm ? `${MONTHS[Number(mm) - 1]} ${String(Number(y) + 543).slice(-2)}` : String(m); };
  const monthFull = (m) => (m === 'done' ? 'เลยวันเก็บเกี่ยวแล้ว (ยังแสดงบนตลาด)' : m === 'none' ? 'ไม่ระบุวันเก็บเกี่ยว' : monthText(m));
  function niceMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  const tick = (v) => (v >= 10000 ? (v / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'K' : v.toLocaleString('th-TH', { maximumFractionDigits: 1 }));
  function chartTip(fig) {
    let tip = fig.querySelector('.ad-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'ad-tip'; tip.setAttribute('role', 'status'); fig.appendChild(tip); }
    const showTip = (m) => {
      const fr = fig.getBoundingClientRect(); const r = m.getBoundingClientRect();
      tip.innerHTML = m.dataset.tip; tip.classList.add('is-on');
      const x = Math.min(Math.max(r.left + r.width / 2 - fr.left, 70), fr.width - 70);
      tip.style.left = x + 'px'; tip.style.top = (r.top - fr.top - 8) + 'px';
      fig.querySelectorAll('.ad-mark').forEach((o) => o.classList.toggle('is-dim', o !== m));
    };
    const hide = () => { tip.classList.remove('is-on'); fig.querySelectorAll('.ad-mark').forEach((o) => o.classList.remove('is-dim')); };
    fig.querySelectorAll('.ad-hit').forEach((h) => {
      const m = h.closest('.ad-mark');
      h.addEventListener('mouseenter', () => showTip(m)); h.addEventListener('focus', () => showTip(m));
      h.addEventListener('mouseleave', hide); h.addEventListener('blur', hide);
    });
  }
  const barPath = (x, y, w, h, horizontal) => {   // 4px rounded data end, square at the baseline
    const r = Math.min(4, horizontal ? w : h, horizontal ? h / 2 : w / 2);
    if (h <= 0 || w <= 0) return '';
    return horizontal
      ? `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
      : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  let chartData = null, chartTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(chartTimer); chartTimer = setTimeout(() => { if (chartData && state.view === 'overview') { drawHarvest(chartData.h); drawMaterials(chartData.m); } }, 200); });
  function drawHarvest(rows) {
    const fig = $('adHarvestChart'); const body = fig.querySelector('.ad-chart-body');
    const order = (m) => (m === 'done' ? '0' : m === 'none' ? 'z' : m);   // past-harvest first, undated last
    const data = rows.filter((h) => h.month).sort((a, b) => order(a.month).localeCompare(order(b.month))).slice(0, 13);
    if (!data.length) { body.innerHTML = '<p class="ad-chart-empty">ยังไม่มีแปลงที่ระบุวันเก็บเกี่ยว</p>'; return; }
    const W = Math.max(300, Math.min(640, body.clientWidth || 560)), H = 240, L = 44, R = 8, T = 22, B = 30;   // drawn at the box width so text stays readable on phones
    const max = niceMax(Math.max(...data.map((d) => d.areaRai || 0)));
    const band = (W - L - R) / data.length; const bw = Math.min(24, band * 0.6);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const ticks = [0, max / 2, max];
    const peak = data.reduce((a, d) => ((d.areaRai || 0) > (a.areaRai || 0) ? d : a), data[0]);
    body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="พื้นที่ใกล้เก็บเกี่ยวรายเดือน สูงสุด ${esc(monthText(peak.month))} ${fmt(peak.areaRai, 0)} ไร่">
      ${ticks.map((t) => `<line class="ad-grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ad-axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${tick(t)}</text>`).join('')}
      ${data.map((d, i) => { const cx = L + band * i + band / 2; const top = y(d.areaRai || 0);
        return `<g class="ad-mark" data-tip="<b>${esc(monthFull(d.month))}</b>${fmt(d.areaRai, 0)} ไร่ · ${fmt(d.plots, 0)} แปลง<br>ชีวมวล ~${fmt(d.ton, 0)} ตัน">
          <path class="ad-bar" d="${barPath(cx - bw / 2, top, bw, y(0) - top)}"/>
          ${d === peak ? `<text class="ad-val" x="${cx}" y="${top - 6}" text-anchor="middle">${fmt(d.areaRai, 0)}</text>` : ''}
          <rect class="ad-hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" tabindex="0" aria-label="${esc(monthText(d.month))} ${fmt(d.areaRai, 0)} ไร่"/>
          <text class="ad-axis" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(monthText(d.month))}</text></g>`; }).join('')}
    </svg>`;
    chartTip(fig);
  }
  function drawMaterials(rows) {
    const fig = $('adMaterialChart'); const body = fig.querySelector('.ad-chart-body');
    let data = rows.filter((m) => (m.areaRai || 0) > 0).sort((a, b) => b.areaRai - a.areaRai);
    if (data.length > 7) { const rest = data.slice(6); data = data.slice(0, 6).concat([{ name: `อื่นๆ (${rest.length} ชนิด)`, areaRai: rest.reduce((a, m) => a + m.areaRai, 0), plots: rest.reduce((a, m) => a + (m.plots || 0), 0), ton: rest.reduce((a, m) => a + (m.ton || 0), 0), buyers: '' }]); }
    if (!data.length) { body.innerHTML = '<p class="ad-chart-empty">ยังไม่มีแปลงประกาศขาย</p>'; return; }
    const W = Math.max(300, Math.min(640, body.clientWidth || 560)), row = 34, T = 6, L = W < 420 ? 112 : 150, R = 56; const H = T + row * data.length + 4;
    const max = Math.max(...data.map((m) => m.areaRai)); const bh = Math.min(20, row - 12);
    const x = (v) => (W - L - R) * (v / max);
    body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="วัสดุเหลือใช้ทางการเกษตรที่ประกาศขาย มากที่สุด ${esc(data[0].name)} ${fmt(data[0].areaRai, 0)} ไร่">
      <line class="ad-grid" x1="${L}" x2="${L}" y1="${T}" y2="${H - 4}"/>
      ${data.map((m, i) => { const cy = T + row * i + row / 2; const w = x(m.areaRai);
        return `<g class="ad-mark" data-tip="<b>${esc(m.name)}</b>${fmt(m.areaRai, 0)} ไร่ · ${fmt(m.plots, 0)} แปลง<br>ชีวมวล ~${fmt(m.ton, 0)} ตัน${m.buyers !== '' && m.buyers !== undefined ? ` · ผู้รับซื้อ ${fmt(m.buyers, 0)} จุด` : ''}">
          <text class="ad-label" x="${L - 8}" y="${cy + 5}" text-anchor="end">${esc(m.name.length > (W < 420 ? 13 : 18) ? m.name.slice(0, W < 420 ? 12 : 17) + '…' : m.name)}</text>
          <path class="ad-bar" d="${barPath(L, cy - bh / 2, w, bh, true)}"/>
          <text class="ad-val" x="${L + w + 6}" y="${cy + 5}">${fmt(m.areaRai, 0)}</text>
          <rect class="ad-hit" x="0" y="${T + row * i}" width="${W}" height="${row}" tabindex="0" aria-label="${esc(m.name)} ${fmt(m.areaRai, 0)} ไร่"/></g>`; }).join('')}
    </svg>`;
    chartTip(fig);
  }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); show(a.dataset.go); } });

  /* users */
  async function loadUsers(q) {
    loading('adUsersTable');
    const r = await api('adminUsersServer', { province: state.province, q: q || $('adUsersSearch').q.value });
    state.users = r.rows;
    $('adUsersTable').innerHTML = table([
      { key: 'name', label: 'ชื่อ', html: (u) => `<b>${esc(u.name)}</b><small>${esc(u.roleLabel)}</small>` },
      { key: 'phone', label: 'เบอร์โทร', html: (u) => `<a href="tel:${esc(u.key)}">${esc(u.phone)}</a>` },
      { key: 'records', label: 'แปลง/จุดรับซื้อ', num: 1 }, { key: 'createdAt', label: 'ลงทะเบียน' },
      { key: 'x', label: '', html: (u) => `<div class="ad-acts"><button type="button" class="ad-btn ad-btn-sm" data-user-edit="${esc(u.key)}">แก้ไข</button><button type="button" class="ad-btn ad-btn-sm ad-btn-danger" data-user-del="${esc(u.key)}">ลบ</button></div>` }
    ], r.rows, { empty: 'ไม่พบผู้ใช้', more: r.total > r.rows.length ? `แสดง ${r.rows.length} จาก ${r.total} ราย — ค้นหาเพื่อกรอง` : `${r.total} ราย` });
  }
  $('adUsersSearch').addEventListener('submit', (e) => { e.preventDefault(); loadUsers().catch((err) => fail('users', err)); });
  $('adUsersTable').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-user-edit]'), del = e.target.closest('[data-user-del]');
    if (ed) {
      const u = state.users.find((x) => x.key === ed.dataset.userEdit);
      const f = await dialog(`<h2>แก้ไขผู้ใช้</h2><p class="ad-help">${esc(u.phone)}</p>
        <label>ชื่อ<input name="name" value="${esc(u.name)}" maxlength="150" required></label>
        <label>บทบาท<select name="role"><option value="farmer"${u.role === 'farmer' ? ' selected' : ''}>เกษตรกร</option><option value="buyer"${u.role === 'buyer' ? ' selected' : ''}>ผู้รับซื้อ</option></select></label>
        ${isSuper() ? '<label>จังหวัด<select name="provinceCode"></select></label>' : ''}`, 'บันทึก', (form) => isSuper() && fillProvinceSelect(form.provinceCode, { value: u.province }));
      if (!f) return;
      await act(() => api('adminUserSaveServer', { phone: u.key, name: f.name, role: f.role, provinceCode: f.provinceCode }), () => loadUsers());
    }
    if (del) {
      const u = state.users.find((x) => x.key === del.dataset.userDel);
      const f = await dialog(`<h2>ลบผู้ใช้?</h2><p><b>${esc(u.name)}</b> (${esc(u.phone)})</p><p class="ad-help">ลบบัญชีและซ่อนแปลง/จุดรับซื้อของผู้ใช้นี้ ${u.records} รายการ ผู้ใช้ลงทะเบียนใหม่ได้ภายหลัง</p>`, 'ลบผู้ใช้', null, true);
      if (!f) return;
      await act(() => api('adminUserDeleteServer', { phone: u.key }), () => loadUsers());
    }
  });

  /* plots for sale / buyer points */
  const STATUS_TEXT = { Open: 'ประกาศขาย', Closed: 'ซ่อน (เจ้าหน้าที่)', Sold: 'ขายแล้ว', Deleted: 'ลบแล้ว', Expired: 'หมดอายุ', Active: 'เปิดรับซื้อ', Inactive: 'ปิดรับซื้อ' };
  const STATUS_CLS = { Open: 'is-ok', Active: 'is-ok', Sold: 'is-warn', Closed: 'is-off', Inactive: 'is-off', Deleted: 'is-off' };
  async function loadRecords(kind) {
    const box = kind === 'farmers' ? 'adFarmersTable' : 'adBuyersTable';
    const f = document.querySelector(`[data-records="${kind}"]`);
    loading(box);
    const r = await api('adminRecordsServer', { kind, province: state.province, q: f.q.value, showDeleted: f.showDeleted.checked });
    const where = (x) => `${esc(x.location.subdistrict ? 'ต.' + x.location.subdistrict + ' ' : '')}${esc(x.location.district ? 'อ.' + x.location.district : '')}` +
      (x.lat && x.lng ? `<small><a href="https://www.google.com/maps?q=${encodeURIComponent(x.lat + ',' + x.lng)}" target="_blank" rel="noopener">เปิดแผนที่</a></small>` : '');
    const status = (x) => `<span class="ad-pill ${STATUS_CLS[x.status] || ''}">${esc(STATUS_TEXT[x.status] || x.status)}</span>` + (kind === 'farmers' && x.status === 'Open' ? `<small>${x.listed ? 'แสดงบนตลาด' : 'ไม่แสดง (เลยวันเก็บเกี่ยว)'}</small>` : '');
    const acts = (x) => `<div class="ad-acts"><select data-status-of="${esc(x.id)}" aria-label="เปลี่ยนสถานะ">${r.statuses.map((s) => `<option value="${s}"${s === x.status ? ' selected' : ''}>${esc(STATUS_TEXT[s] || s)}</option>`).join('')}</select></div>`;
    const cols = kind === 'farmers' ? [
      { key: 'ownerName', label: 'เกษตรกร', html: (x) => `<b>${esc(x.ownerName)}</b><small><a href="tel:${esc(x.owner)}">${esc(x.owner)}</a></small>` },
      { key: 'crop', label: 'พืช / วัสดุ', html: (x) => `${esc(x.crop)}<small>${esc(x.material)}</small>` }, { key: 'areaRai', label: 'พื้นที่ (ไร่)', num: 1 },
      { key: 'harvestDate', label: 'วันเก็บเกี่ยว' }, { key: 'where', label: 'ที่ตั้ง', html: where }, { key: 'status', label: 'สถานะ', html: status }, { key: 'x', label: 'จัดการ', html: acts }
    ] : [
      { key: 'ownerName', label: 'ผู้รับซื้อ', html: (x) => `<b>${esc(x.ownerName)}</b><small><a href="tel:${esc(x.owner)}">${esc(x.owner)}</a></small>` },
      { key: 'material', label: 'วัสดุที่รับซื้อ' }, { key: 'price', label: 'ราคา (บาท/ไร่)', num: 1 }, { key: 'capacity', label: 'รับได้ (ตัน/วัน)' },
      { key: 'where', label: 'ที่ตั้ง', html: where }, { key: 'status', label: 'สถานะ', html: status }, { key: 'x', label: 'จัดการ', html: acts }
    ];
    const more = r.total > r.rows.length ? `แสดง ${r.rows.length} จาก ${r.total} รายการ — ค้นหาเพื่อกรอง` : `${r.total} รายการ`;
    // 4.2.0: status filter pills (client side, over the rows already loaded)
    const pills = document.querySelector(`[data-filters="${kind}"]`);
    const counts = {}; r.rows.forEach((x) => { counts[x.status] = (counts[x.status] || 0) + 1; });
    const keys = Object.keys(counts);
    let cur = state['filter_' + kind] || ''; if (cur && !counts[cur]) cur = '';
    const paint = () => {
      pills.innerHTML = [['', 'ทั้งหมด', r.rows.length]].concat(keys.map((k) => [k, STATUS_TEXT[k] || k, counts[k]]))
        .map(([k, label, n]) => `<button type="button" class="ad-fpill" data-f="${esc(k)}" aria-pressed="${k === cur}">${esc(label)} <span>${fmt(n, 0)}</span></button>`).join('');
      $(box).innerHTML = table(cols, cur ? r.rows.filter((x) => x.status === cur) : r.rows, { empty: 'ไม่พบรายการ', more });
    };
    pills.onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; cur = b.dataset.f; state['filter_' + kind] = cur; paint(); };
    paint();
    $(box).dataset.kind = kind;
  }
  document.querySelectorAll('[data-records]').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); loadRecords(f.dataset.records).catch((err) => fail(f.dataset.records, err)); }));
  ['adFarmersTable', 'adBuyersTable'].forEach((id) => $(id).addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status-of]'); if (!sel) return;
    const kind = $(id).dataset.kind;
    if (sel.value === 'Deleted') {
      const ok = await dialog('<h2>ลบรายการนี้?</h2><p class="ad-help">รายการจะหายจากตลาดและจากหน้าของเจ้าของ (ข้อมูลยังเก็บไว้ในฐานข้อมูล กู้คืนได้โดยเปลี่ยนสถานะ)</p>', 'ลบ', null, true);
      if (!ok) { loadRecords(kind); return; }
    }
    await act(() => api('adminRecordStatusServer', { kind, id: sel.dataset.statusOf, status: sel.value }), () => loadRecords(kind));
  }));

  /* dialogs */
  function dialog(html, okLabel, onOpen, danger) {
    return new Promise((resolve) => {
      const d = $('adDialog'), f = $('adDialogForm');
      f.innerHTML = html + `<p class="ad-msg" id="adDialogMsg"></p><div class="ad-actions"><button type="submit" value="ok" class="ad-btn ${danger ? 'ad-btn-danger' : 'ad-btn-primary'}">${esc(okLabel)}</button><button type="submit" value="cancel" class="ad-btn" formnovalidate>ยกเลิก</button></div>`;
      if (onOpen) onOpen(f);
      d.returnValue = '';
      d.onclose = () => {
        if (d.returnValue !== 'ok') return resolve(null);
        const out = {}; [...f.elements].forEach((el) => { if (el.name) out[el.name] = el.value; }); resolve(out);
      };
      d.showModal();
      const first = f.querySelector('input,select'); if (first) first.focus();
    });
  }
  async function act(fn, then) {
    try { const r = await fn(); toast(r && r.message || 'บันทึกแล้ว'); if (then) await then(); }
    catch (err) { toast(err.message, true); }
  }
  function toast(text, bad) {
    let t = document.querySelector('.ad-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ad-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t);
      Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '1.2rem', transform: 'translateX(-50%)', padding: '.7rem 1.1rem', borderRadius: '12px', color: '#fff', fontWeight: '600', zIndex: 99, maxWidth: '92vw', boxShadow: '0 8px 24px rgba(0,0,0,.2)' }); }
    t.style.background = bad ? '#b42318' : '#0f4d24'; t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  /* admins (Super) */
  const ADMIN_STATUS = { pending: ['รออนุมัติ', 'is-warn'], active: ['ใช้งาน', 'is-ok'], disabled: ['ระงับ', 'is-off'], rejected: ['ไม่อนุมัติ', 'is-off'] };
  async function loadAdmins() {
    loading('adAdminsTable');
    const r = await api('adminsListServer');
    state.admins = r.rows.sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
    $('adAdminsTable').innerHTML = table([
      { key: 'name', label: 'ชื่อ', html: (a) => `<b>${esc(a.name)}</b><small>${esc(a.username)}</small>` },
      { key: 'roleLabel', label: 'บทบาท', html: (a) => `${esc(a.roleLabel)}<small>${esc(a.provinceName ? 'จ.' + a.provinceName : 'ทุกจังหวัด')}</small>` },
      { key: 'agency', label: 'หน่วยงาน / โทร', html: (a) => `${esc(a.agency)}<small>${esc(a.phone)}</small>` },
      { key: 'status', label: 'สถานะ', html: (a) => `<span class="ad-pill ${(ADMIN_STATUS[a.status] || [])[1] || ''}">${esc((ADMIN_STATUS[a.status] || [a.status])[0])}</span>${a.approvedBy ? `<small>อนุมัติโดย ${esc(a.approvedBy)}</small>` : ''}` },
      { key: 'lastLogin', label: 'เข้าใช้ล่าสุด' },
      { key: 'x', label: 'จัดการ', html: (a) => `<div class="ad-acts">${a.status === 'pending' ? `<button type="button" class="ad-btn ad-btn-sm ad-btn-primary" data-adm="approve" data-u="${esc(a.username)}">อนุมัติ</button><button type="button" class="ad-btn ad-btn-sm ad-btn-danger" data-adm="reject" data-u="${esc(a.username)}">ไม่อนุมัติ</button>` : ''}
        <button type="button" class="ad-btn ad-btn-sm" data-adm="edit" data-u="${esc(a.username)}">แก้ไข</button><button type="button" class="ad-btn ad-btn-sm" data-adm="pw" data-u="${esc(a.username)}">ตั้งรหัสผ่านใหม่</button></div>` }
    ], state.admins, { empty: 'ยังไม่มีเจ้าหน้าที่' });
  }
  $('adAdminsTable').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-adm]'); if (!b) return;
    const a = state.admins.find((x) => x.username === b.dataset.u);
    if (b.dataset.adm === 'approve') return act(() => api('adminSaveServer', { username: a.username, status: 'active' }), loadAdmins);
    if (b.dataset.adm === 'reject') { if (await dialog(`<h2>ไม่อนุมัติคำขอ?</h2><p>${esc(a.name)} · จ.${esc(a.provinceName)}</p>`, 'ไม่อนุมัติ', null, true)) act(() => api('adminSaveServer', { username: a.username, status: 'rejected' }), loadAdmins); return; }
    if (b.dataset.adm === 'edit') {
      const f = await dialog(`<h2>แก้ไขเจ้าหน้าที่</h2><p class="ad-help">${esc(a.name)} (${esc(a.username)})</p>
        <label>บทบาท<select name="role"><option value="admin"${a.role === 'admin' ? ' selected' : ''}>Admin (จังหวัดเดียว)</option><option value="super"${a.role === 'super' ? ' selected' : ''}>Super Admin (ทุกจังหวัด)</option></select></label>
        <label>จังหวัด (สำหรับ Admin)<select name="provinceCode"></select></label>
        <label>สถานะ<select name="status">${Object.keys(ADMIN_STATUS).map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${ADMIN_STATUS[s][0]}</option>`).join('')}</select></label>`,
      'บันทึก', (form) => fillProvinceSelect(form.provinceCode, { placeholder: '-', value: a.province }));
      if (f) act(() => api('adminSaveServer', { username: a.username, role: f.role, status: f.status, provinceCode: f.provinceCode }), loadAdmins);
      return;
    }
    if (b.dataset.adm === 'pw') {
      const f = await dialog(`<h2>ตั้งรหัสผ่านใหม่</h2><p class="ad-help">${esc(a.name)} (${esc(a.username)}) — แจ้งรหัสให้เจ้าของบัญชีทางช่องทางที่ปลอดภัย และให้เปลี่ยนเองหลังเข้าสู่ระบบ</p>
        <label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>`, 'ตั้งรหัสผ่าน');
      if (f) act(() => api('adminResetPasswordServer', { username: a.username, password: f.password }));
    }
  });

  /* market rule (Super) */
  async function loadRule() {
    const r = await api('marketRuleServer'); const x = r.rule;
    $('adRuleForm').days.value = x.hideAfterHarvestDays;
    $('adRuleForm').nearKm.value = r.nearRadiusKm || 50;   // 4.2.0
    $('adRuleInfo').textContent = `ตอนนี้: ${x.hideAfterHarvestDays ? 'แสดงถึง ' + x.hideAfterHarvestDays + ' วันหลังวันเก็บเกี่ยว' : 'ไม่จำกัด'} · แปลงที่แสดง ${x.listedPlots} · ไม่แสดง ${x.hiddenPlots} (ทุกจังหวัด) · รัศมีคู่ค้าต่างจังหวัด ${r.nearRadiusKm || 50} กม.`;
  }
  $('adRuleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target.querySelector('[type=submit]'), 'กำลังบันทึก…', async () => {
      try { await api('marketRuleSaveServer', { hideAfterHarvestDays: Number(e.target.days.value), nearRadiusKm: Number(e.target.nearKm.value) }); msg('adRuleMsg', 'บันทึกแล้ว มีผลกับตลาดทุกจังหวัดทันที', true); loadRule(); }
      catch (err) { msg('adRuleMsg', err.message); }
    });
  });

  /* log (Super) */
  async function loadLog() {
    loading('adLogTable');
    const r = await api('adminLogServer', { province: 'ALL' });
    $('adLogTable').innerHTML = table([{ key: 'time', label: 'เวลา' }, { key: 'username', label: 'ผู้ใช้', html: (x) => `${esc(x.name || x.username)}<small>${esc(x.username)}</small>` },
      { key: 'province', label: 'จังหวัด' }, { key: 'action', label: 'การกระทำ' }, { key: 'detail', label: 'รายละเอียด' }], r.rows, { empty: 'ยังไม่มีประวัติ', more: '300 รายการล่าสุด' });
  }

  /* account */
  async function loadAccount() {
    const me = await api('adminMeServer');
    $('adAccount').innerHTML = [['ชื่อ', me.name], ['ชื่อผู้ใช้', me.username], ['บทบาท', me.roleLabel], ['จังหวัด', me.provinceName || 'ทุกจังหวัด'], ['หน่วยงาน', me.agency || '-'], ['โทร', me.phone || '-']]
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }
  $('adPwForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    if (f.next.value !== f.next2.value) return msg('adPwMsg', 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    busy(f.querySelector('[type=submit]'), 'กำลังบันทึก…', async () => {
      try { await api('adminChangePasswordServer', { current: f.current.value, next: f.next.value }); f.reset(); msg('adPwMsg', 'เปลี่ยนรหัสผ่านแล้ว', true); }
      catch (err) { msg('adPwMsg', err.message); }
    });
  });

  /* ---------------- reports ---------------- */
  async function loadReports() {
    if (!state.catalog) state.catalog = await api('reportCatalogServer');
    const c = state.catalog;
    $('adReportTypes').innerHTML = c.types.map((t, i) => `<button type="button" data-type="${esc(t.key)}" aria-pressed="${i === 0}">${esc(t.title)}</button>`).join('');
    $('adReportSections').innerHTML = c.sections.map((s) => `<label><input type="checkbox" name="sections" value="${esc(s.key)}"><span>${esc(s.title)}<small>${esc(s.desc)}</small></span></label>`).join('');
    const sel = $('adReportProvince');
    if (!sel.options.length) await fillProvinceSelect(sel, { all: c.allProvinces, only: c.allProvinces ? '' : c.province, value: c.allProvinces ? (state.province || '62') : c.province });
    sel.disabled = !c.allProvinces;
    chooseType(c.types[0].key);
  }
  function chooseType(key) {
    const t = state.catalog.types.find((x) => x.key === key); if (!t) return;
    $('adReportTypes').querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === key)));
    $('adReportSections').querySelectorAll('input').forEach((i) => { i.checked = t.sections.indexOf(i.value) >= 0; });
    syncTitle(t);
  }
  function syncTitle(t) {
    t = t || state.catalog.types.find((x) => $('adReportTypes').querySelector(`[data-type="${x.key}"][aria-pressed="true"]`));
    const p = $('adReportProvince'); const name = p.value === 'ALL' ? 'ทุกจังหวัด' : 'จังหวัด' + ((p.selectedOptions[0] || {}).textContent || '');
    $('adReportTitle').value = `${t ? t.title : 'รายงาน'} ตลาดวัสดุเหลือใช้ทางการเกษตร Green Gain Hub ${name}`;
  }
  $('adReportTypes').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) chooseType(b.dataset.type); });
  $('adReportProvince').addEventListener('change', () => syncTitle());
  $('adReportForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    const sections = [...f.querySelectorAll('input[name=sections]:checked')].map((i) => i.value);
    if (!sections.length) return msg('adReportMsg', 'กรุณาเลือกหัวข้ออย่างน้อย 1 หัวข้อ');
    msg('adReportMsg', '');
    busy(f.querySelector('[type=submit]'), 'กำลังสร้างรายงาน…', async () => {
      try {
        state.report = await api('reportDataServer', { sections, province: f.province.value, from: f.from.value, to: f.to.value, title: f.title.value });
        renderReport(state.report); $('adReportPrint').disabled = false;
      } catch (err) { msg('adReportMsg', err.message); }
    });
  });
  const thDate = (iso, time) => { const d = iso ? new Date(iso) : new Date(); return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) + (time ? ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : ''); };
  const periodText = (r) => r.period.from || r.period.to ? `การขาย/ลงทะเบียน ${r.period.from ? thDate(r.period.from) : 'เริ่มต้น'} – ${r.period.to ? thDate(r.period.to) : 'ปัจจุบัน'}` : 'การขาย/ลงทะเบียน ทั้งหมด';
  function sectionTable(s) {
    const cols = s.columns.map((c) => ({ key: c.key, label: c.label, num: c.type === 'number' }));
    return table(cols, s.rows, { totals: s.totals, empty: s.empty });
  }
  function renderReport(r) {
    $('adReportView').innerHTML = `<div class="ad-rep"><div class="ad-rep-head"><h2>${esc(r.title)}</h2><p>${esc(r.scope.name)} · ข้อมูล ณ ${esc(thDate(r.generatedAt, true))} · ${esc(periodText(r))} · ${esc(r.by)}</p></div>` +
      r.sections.map((s) => `<h2>${esc(s.title)}</h2><div class="ad-tablewrap">${sectionTable(s)}</div>${s.notes && s.notes.length ? `<ul class="ad-notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`).join('') + '</div>';
  }
  $('adReportPrint').addEventListener('click', (e) => busy(e.currentTarget, 'กำลังเตรียมหน้าพิมพ์…', () => printReport(state.report)));

  /* A4 landscape print — page 1: map + legend + KPIs | every district; next pages: the other sections */
  const SEQ = ['#eef2ef', '#d3ead8', '#a3d3ae', '#63b077', '#2f8b49', '#155f2c'];
  function classes(values) {
    const v = values.filter((x) => x > 0).sort((a, b) => a - b);
    if (!v.length) return [];
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return [...new Set([q(0.2), q(0.4), q(0.6), q(0.8)].map((x) => Math.round(x)))];
  }
  const colorOf = (val, br) => (!val ? SEQ[0] : SEQ[1 + Math.min(4, br.filter((b) => val > b).length)]);
  function head(r, sub) {
    return `<header class="pr-head"><img class="pr-logo" src="https://doaenews.doae.go.th/wp-content/uploads/2021/03/DOAE-2.png" alt="" crossorigin="anonymous">
      <div class="pr-title"><h1>${esc(r.title)}</h1><p>${esc(sub || 'ศูนย์กลางเชื่อมโยงการซื้อ-ขายวัสดุเหลือใช้ทางการเกษตร Green Gain Hub')}</p></div>
      <dl class="pr-meta"><div><dt>ขอบเขต</dt><dd>${esc(r.scope.name)}</dd></div><div><dt>ช่วงข้อมูล</dt><dd>${esc(periodText(r).replace('การขาย/ลงทะเบียน ', ''))}</dd></div>
      <div><dt>ข้อมูลล่าสุด</dt><dd>${esc(thDate(r.generatedAt, true))}</dd></div><div><dt>วันที่พิมพ์</dt><dd>${esc(thDate())}</dd></div></dl></header>`;
  }
  const foot = (r, i, n) => `<footer class="pr-foot"><span>ที่มา: Green Gain Hub (ข้อมูลที่เกษตรกรและผู้รับซื้อบันทึก) · ขอบเขตการปกครอง: ชุดข้อมูล Thailand Agri-Risk Map Burning · แผนที่ฐาน Tiles © Esri · จัดทำโดย ${esc(r.by)}</span><span>หน้า ${i}/${n}</span></footer>`;
  function prTable(cols, rows, totals) {
    return `<table class="pr-table"><thead><tr>${cols.map((c) => `<th${c.type === 'number' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((row) => `<tr>${cols.map((c) => `<td${c.type === 'number' ? ' class="num"' : ''}>${c.type === 'number' ? fmt(row[c.key]) : esc(row[c.key])}</td>`).join('')}</tr>`).join('') + '</tbody>' +
      (totals ? `<tfoot><tr>${cols.map((c) => `<td${c.type === 'number' ? ' class="num"' : ''}>${totals[c.key] === undefined || totals[c.key] === null ? '' : c.type === 'number' ? fmt(totals[c.key]) : esc(totals[c.key])}</td>`).join('')}</tr></tfoot>` : '') + '</table>';
  }
  let prMap = null;
  async function printReport(r) {
    if (!r || !window.L) return;
    const box = $('print-report');
    const byP = r.scope.by === 'province';
    const vals = r.map.values;
    const br = classes(vals.map((v) => v.areaRai));
    const S = r.summary || {};
    // page 1 — like Agri-Risk Map: map | the full area table
    const areaRows = vals.slice().sort((a, b) => b.areaRai - a.areaRai || b.buyers - a.buyers || a.name.localeCompare(b.name, 'th')).map((v, i) => ({ no: i + 1, name: v.name, plots: v.plots, area: v.areaRai, buyers: v.buyers }));
    const areaCols = [{ key: 'no', label: 'ลำดับ', type: 'number' }, { key: 'name', label: byP ? 'จังหวัด' : 'อำเภอ' }, { key: 'plots', label: 'แปลง', type: 'number' }, { key: 'area', label: 'พื้นที่ (ไร่)', type: 'number' }, { key: 'buyers', label: 'ผู้รับซื้อ (จุด)', type: 'number' }];
    const sum = (k) => areaRows.reduce((t, x) => t + (Number(x[k]) || 0), 0);
    const legend = [`<span><i style="background:${SEQ[0]}"></i>ไม่มีแปลง</span>`].concat(br.length ? br.map((b, i) => `<span><i style="background:${SEQ[1 + i]}"></i>${i === 0 ? '≤ ' + fmt(b, 0) : fmt(br[i - 1] + 1, 0) + '–' + fmt(b, 0)} ไร่</span>`).concat([`<span><i style="background:${SEQ[1 + br.length]}"></i>&gt; ${fmt(br[br.length - 1], 0)} ไร่</span>`]) : [`<span><i style="background:${SEQ[1]}"></i>มีแปลงประกาศขาย</span>`]).join('') + '<span class="north">▲ ทิศเหนือ</span>';
    const kpis = [[fmt(S.areaRai, 0) + ' ไร่', 'พื้นที่ประกาศขาย (ข้อมูลจริง)'], [fmt(S.farmers, 0) + ' ราย', 'เกษตรกรผู้ขาย'], [fmt(S.ton, 0) + ' ตัน', 'ชีวมวล (ประมาณการ)'], [fmt(S.salesBaht, 0) + ' บาท', 'รายได้จากการขายจริง']];
    const pages = [{ html: `<div class="pr-body"><div class="pr-left"><div class="pr-map" id="pr-map"></div><div class="pr-legend">${legend}</div><div class="pr-kpis">${kpis.map((k) => `<div><b>${esc(k[0])}</b><span>${esc(k[1])}</span></div>`).join('')}</div></div>
      <div class="pr-right"><h2>แปลงประกาศขายและผู้รับซื้อ ราย${byP ? 'จังหวัด' : 'อำเภอ'} — ครบ ${areaRows.length} ${byP ? 'จังหวัด' : 'อำเภอ'}</h2>${prTable(areaCols, areaRows, { name: 'รวม', plots: sum('plots'), area: sum('area'), buyers: sum('buyers') })}
      <ul class="pr-notes"><li>${esc(r.notes.estimates)}</li><li>${esc(r.notes.costs)}</li></ul></div></div>` }];
    // next pages — the chosen sections, long tables split over pages
    const PER = 24;
    r.sections.forEach((s) => {
      const rows = s.rows.length ? s.rows : [Object.fromEntries([[s.columns[0].key, s.empty || 'ไม่มีข้อมูล']])];
      for (let i = 0; i < rows.length; i += PER) {
        const last = i + PER >= rows.length;
        pages.push({ html: `<div class="pr-body is-full"><div class="pr-right"><h2>${esc(s.title)}${rows.length > PER ? ` (${Math.floor(i / PER) + 1}/${Math.ceil(rows.length / PER)})` : ''}</h2>${prTable(s.columns, rows.slice(i, i + PER), last ? s.totals : null)}${last && s.notes && s.notes.length ? `<ul class="pr-notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div></div>` });
      }
    });
    box.innerHTML = pages.map((p, i) => `<div class="pr-page">${head(r)}${p.html}${foot(r, i + 1, pages.length)}</div>`).join('');
    fitTables(box);
    // the map
    if (prMap) { prMap.remove(); prMap = null; }
    prMap = L.map('pr-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0.1, fadeAnimation: false, zoomAnimation: false });
    const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true }).addTo(prMap);
    const byCode = {}; vals.forEach((v) => { byCode[v.code] = v; });
    let feats = [];
    try {
      if (byP) feats = (await provinceIndex()).filter((p) => p.geometry).map((p) => ({ type: 'Feature', properties: { code: String(p.code), name: p.name, center: p.center }, geometry: p.geometry }));
      else { const g = await (await fetch(GEO + 'p/' + r.map.province + '.json', { cache: 'force-cache' })).json(); feats = g.districts.map((d) => ({ type: 'Feature', properties: { code: d.code, name: d.name, center: d.center }, geometry: d.geometry })); }
    } catch (err) { feats = []; }
    const layer = L.geoJSON({ type: 'FeatureCollection', features: feats }, { interactive: false,
      style: (f) => ({ color: '#ffffff', weight: byP ? 0.5 : 1, fillColor: colorOf((byCode[f.properties.code] || {}).areaRai, br), fillOpacity: 0.85 }) }).addTo(prMap);
    L.geoJSON({ type: 'FeatureCollection', features: feats }, { interactive: false, style: { color: '#334155', weight: byP ? 0.4 : 1.1, fill: false } }).addTo(prMap);
    if (!byP) feats.forEach((f) => { const c = f.properties.center; if (c) L.tooltip({ permanent: true, direction: 'center', className: 'pr-label', interactive: false }).setLatLng(c).setContent(`<span style="font-size:${feats.length > 14 ? 7.5 : 9}px">${esc(f.properties.name)}</span>`).addTo(prMap); });
    prMap.invalidateSize({ pan: false });
    if (feats.length) prMap.fitBounds(layer.getBounds(), { padding: [10, 10], animate: false }); else prMap.setView([13.5, 100.9], 5);
    await new Promise((resolve) => { let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
      base.once('load', () => setTimeout(fin, 250)); setTimeout(fin, 4500); });
    window.print();
  }
  /** shrink a page's table text until it fits the page (Agri-Risk Map does the same) */
  function fitTables(box) {
    box.querySelectorAll('.pr-page').forEach((pg) => {
      const right = pg.querySelector('.pr-right'), t = pg.querySelector('.pr-table'); if (!right || !t) return;
      let f = 8.5, p = 1.2;
      const set = () => { t.style.setProperty('--pr-fs', f.toFixed(2) + 'pt'); t.style.setProperty('--pr-pad', p.toFixed(2) + 'mm'); };
      set();
      const fits = () => right.scrollHeight <= right.clientHeight + 1;
      if (!fits()) { const notes = right.querySelector('.pr-notes'); if (notes) notes.style.display = 'none'; }
      while (!fits() && f > 5.2) { f -= 0.25; p = Math.max(0.15, p - 0.1); set(); }
    });
  }

  /* ---------------- start ---------------- */
  authTab(location.hash === '#register' ? 'register' : 'login');
  if (state.token) api('adminMeServer').then(start).catch(() => signOut(false));
})();
