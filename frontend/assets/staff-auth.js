/* Green Gain Hub 2.2.1 — officer sign-in by phone and self-registration, shared by the homepage popup and admin.html.
   A form uses the field names name, phone, officeType, group, district, province; the group and district fields sit
   inside elements marked data-reg="group" / data-reg="district" so they can be shown for the chosen office type. */
(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const API = cfg.SHEETS_API_URL || '';
  const TOKEN_KEY = 'ggh_admin_token';
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const digits = (v) => String(v || '').replace(/\D/g, '');
  let meta = null;

  async function call(method, arg) {
    if (!API) throw new Error('ยังไม่ได้ตั้งค่า SHEETS_API_URL ใน assets/config.js');
    const res = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, args: arg === undefined ? [] : [arg], token: '' }) });
    if (!res.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + res.status + ')');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data.result;
  }

  async function loadMeta() {
    if (!meta) meta = await call('staffMetaServer');
    return meta;
  }

  /** Fills the selects of a registration form and wires the office-type switch. */
  async function prepareRegister(form, listId) {
    const m = await loadMeta();
    if (form.dataset.ready) return m;
    form.officeType.innerHTML = '<option value="">เลือกหน่วยงาน</option>' + Object.entries(m.officeTypes).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    form.group.innerHTML = '<option value="">เลือกกลุ่ม</option>' + m.groups.map((g) => `<option>${esc(g)}</option>`).join('');
    form.district.innerHTML = '<option value="">เลือกอำเภอ</option>' + m.districts.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
    const list = listId && document.getElementById(listId);
    if (list) list.innerHTML = m.provinces.map((p) => `<option value="${esc(p)}">`).join('');
    if (!form.province.value) form.province.value = m.province;
    form.officeType.addEventListener('change', () => syncOffice(form));
    syncOffice(form);
    form.dataset.ready = '1';
    return m;
  }

  function syncOffice(form) {
    const prov = form.officeType.value === 'province';
    form.querySelectorAll('[data-reg="group"]').forEach((el) => el.classList.toggle('hidden', !prov));
    form.querySelectorAll('[data-reg="district"]').forEach((el) => el.classList.toggle('hidden', prov));
  }

  /** Reads and checks a registration form. Returns { input, missing }. */
  function readRegister(form) {
    const input = { name: form.name.value.trim().replace(/\s+/g, ' '), phone: digits(form.phone.value), officeType: form.officeType.value,
      group: form.group.value, district: form.district.value, province: form.province.value.trim() };
    const missing = [];
    if (!/\S+\s+\S+/.test(input.name)) missing.push('ชื่อ-สกุล');
    if (!/^0\d{9}$/.test(input.phone)) missing.push('หมายเลขโทรศัพท์ 10 หลัก');
    if (!input.officeType) missing.push('หน่วยงาน');
    if (input.officeType === 'province' && !input.group) missing.push('กลุ่ม');
    if (input.officeType === 'district' && !input.district) missing.push('อำเภอ');
    if (!input.province) missing.push('จังหวัด');
    return { input, missing };
  }

  /** Signs in by phone; the session token is kept for admin.html (same tab). */
  async function login(phone) {
    const p = digits(phone);
    if (!/^0\d{9}$/.test(p)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
    const r = await call('staffLoginServer', { phone: p });
    sessionStorage.setItem(TOKEN_KEY, r.token);
    return r;
  }

  async function register(input) {
    const r = await call('staffRegisterServer', input);
    sessionStorage.setItem(TOKEN_KEY, r.token);
    return r;
  }

  window.GGH_STAFF = { TOKEN_KEY, call, loadMeta, prepareRegister, syncOffice, readRegister, login, register, digits,
    hasSession: () => !!sessionStorage.getItem(TOKEN_KEY) };
})();
