/**
 * Green Gain Hub 1.7.0 — reports for Super Admin / Admin (print, PDF, Excel, CSV).
 *
 * The server returns tables only; the admin page renders, prints and exports
 * them. Every request is checked against the role here and written to admin_log.
 * Sections with names or phone numbers are Super Admin only, and phones are
 * masked unless the Super Admin explicitly asks for full numbers.
 */
const REPORT_GROUPS = [
  { key: 'crops', title: 'ก. สถานการณ์การเพาะปลูก', sections: [
    { key: 'crops.summary', title: 'สรุปภาพรวมจังหวัด' },
    { key: 'crops.monthly', title: 'พื้นที่เก็บเกี่ยวรายเดือน' },
    { key: 'crops.districts', title: 'รายอำเภอ' },
    { key: 'crops.subdistricts', title: 'รายตำบล' }] },
  { key: 'reports', title: 'ข. รายงานอำเภอ (KPP Smart Agri-Materials)', sections: [
    { key: 'reports.status', title: 'สถานะการส่งรายงาน' },
    { key: 'reports.indicators', title: 'ผลการดำเนินงานรายอำเภอ (R29–R31)' },
    { key: 'reports.series', title: 'ยอดสะสมรายครั้ง' }] },
  { key: 'market', title: 'ค. ตลาดเศษวัสดุ', sections: [
    { key: 'market.districts', title: 'สรุปรายอำเภอ' },
    { key: 'market.materials', title: 'สรุปตามชนิดเศษวัสดุ' },
    { key: 'market.plots', title: 'รายการแปลงพร้อมขาย (มีชื่อและเบอร์โทร)', role: 'super' },
    { key: 'market.buyers', title: 'รายการจุดรับซื้อ (มีชื่อและเบอร์โทร)', role: 'super' }] },
  { key: 'visits', title: 'ง. สถิติผู้เข้าชม', sections: [
    { key: 'visits.monthly', title: 'รายเดือน' },
    { key: 'visits.daily', title: 'รายวัน (90 วันล่าสุด)' }] },
  { key: 'audit', title: 'จ. ประวัติการนำเข้าและบันทึกการใช้งาน', sections: [
    { key: 'audit.imports', title: 'ประวัติการนำเข้าข้อมูลเพาะปลูก' },
    { key: 'audit.log', title: 'บันทึกการใช้งานผู้ดูแล (200 รายการล่าสุด)', role: 'super' }] }
];
const REPORT_MAX_SECTIONS = 20;

function reportSectionDef_(key) {
  for (let g = 0; g < REPORT_GROUPS.length; g++) {
    const s = REPORT_GROUPS[g].sections.find(function (x) { return x.key === key; });
    if (s) return { group: REPORT_GROUPS[g], section: s };
  }
  return null;
}

/** What this admin may report on, plus the crop / month options. */
function reportCatalog_(s) {
  const crops = (getCropSummary_(false).crops || []).map(function (c) {
    return { key: c.crop + '|' + c.season, crop: c.crop, season: c.season, firstMonth: c.firstMonth, lastMonth: c.lastMonth, asOfMonth: c.asOfMonth };
  });
  return {
    status: 'success',
    role: s.role,
    groups: REPORT_GROUPS.map(function (g) {
      return { key: g.key, title: g.title, sections: g.sections.map(function (x) {
        return { key: x.key, title: x.title, allowed: !x.role || s.role === 'super', superOnly: x.role === 'super' };
      }) };
    }),
    crops: crops,
    office: 'สำนักงานเกษตรจังหวัดกำแพงเพชร'
  };
}

function maskPhone_(v) {
  const p = displayPhone_(v);
  return /^0\d{9}$/.test(p) ? p.slice(0, 3) + '-xxx-' + p.slice(6) : (p ? 'xxx' : '');
}
function fullPhone_(v) {
  const p = displayPhone_(v);
  return /^0\d{9}$/.test(p) ? p.slice(0, 3) + '-' + p.slice(3, 6) + '-' + p.slice(6) : p;
}

function col_(key, label, type) { return { key: key, label: label, type: type || 'text' }; }

function reportData_(input, s) {
  input = input || {};
  const keys = Array.isArray(input.sections) ? input.sections.map(String) : [];
  if (!keys.length) throw new Error('กรุณาเลือกอย่างน้อย 1 ส่วนของรายงาน');
  if (keys.length > REPORT_MAX_SECTIONS) throw new Error('เลือกได้ไม่เกิน ' + REPORT_MAX_SECTIONS + ' ส่วน');
  keys.forEach(function (k) {
    const def = reportSectionDef_(k);
    if (!def) throw new Error('ไม่รู้จักส่วนรายงาน ' + cleanText_(k, 40));
    if (def.section.role === 'super' && s.role !== 'super') throw new Error('ส่วน "' + def.section.title + '" เฉพาะ Super Admin เท่านั้น');
  });
  const unmask = !!input.unmaskPhones && s.role === 'super';
  const ctx = { input: input, s: s, unmask: unmask, crop: null, asOf: null };

  if (keys.some(function (k) { return k.indexOf('crops.') === 0; })) {
    const list = getCropSummary_(false).crops || [];
    const want = String(input.cropKey || '');
    ctx.crop = list.find(function (c) { return c.crop + '|' + c.season === want; }) || list[0] || null;
    if (!ctx.crop) throw new Error('ยังไม่มีข้อมูลเพาะปลูกที่นำเข้า');
    const asOf = Number(input.asOf) || ctx.crop.asOfMonth;
    if (!/^\d{6}$/.test(String(asOf))) throw new Error('เดือนอ้างอิงไม่ถูกต้อง');
    ctx.asOf = asOf;
  }

  const sections = keys.map(function (k) {
    const def = reportSectionDef_(k);
    const out = REPORT_BUILDERS[k](ctx);
    out.key = k;
    out.group = def.group.title;
    out.title = out.title || def.section.title;
    return out;
  });
  const contacts = keys.filter(function (k) { return k === 'market.plots' || k === 'market.buyers'; });
  adminAudit_(s, 'report_view', keys.join(', ') + (contacts.length ? (unmask ? ' [เบอร์เต็ม]' : ' [ปิดบังเบอร์]') : '') +
    (ctx.crop ? ' | ' + ctx.crop.crop + ' ' + ctx.crop.season + ' ณ ' + ctx.asOf : ''));
  return {
    status: 'success',
    title: cleanText_(input.title, 150) || 'รายงาน Green Gain Hub จังหวัดกำแพงเพชร',
    office: 'สำนักงานเกษตรจังหวัดกำแพงเพชร',
    generatedAt: dateTime_(new Date()),
    generatedBy: s.name + ' (' + (s.role === 'super' ? 'Super Admin' : 'Admin') + ')',
    crop: ctx.crop ? { crop: ctx.crop.crop, season: ctx.crop.season, asOf: ctx.asOf } : null,
    phonesMasked: !unmask,
    sections: sections
  };
}

/** Logged when the admin actually prints or downloads, so the log shows the format. */
function reportExportLog_(input, s) {
  input = input || {};
  const format = ['print', 'xlsx', 'csv'].indexOf(String(input.format)) >= 0 ? String(input.format) : 'unknown';
  const keys = Array.isArray(input.sections) ? input.sections.slice(0, REPORT_MAX_SECTIONS).map(function (k) { return cleanText_(k, 40); }) : [];
  adminAudit_(s, 'report_export', format + ': ' + keys.join(', ') + (input.unmaskPhones ? ' [เบอร์เต็ม]' : ''));
  return { status: 'success' };
}

/* ------------------------------ builders ------------------------------ */

function cropHarvestedTo_(months, asOf) {
  return Object.keys(months).filter(function (k) { return Number(k) <= asOf; }).reduce(function (a, k) { return a + Number(months[k]); }, 0);
}
function ymText_(ym) {
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const y = Math.floor(ym / 100), m = ym % 100;
  return TH[m - 1] + ' ' + (y + 543);
}
function pct_(a, b) { return b ? round_(a / b * 100, 1) : 0; }

const REPORT_BUILDERS = {
  'crops.summary': function (ctx) {
    const c = ctx.crop, m = ctx.asOf;
    const total = c.months.reduce(function (a, x) { return a + x.areaRai; }, 0);
    const harvested = c.months.filter(function (x) { return x.month <= m; }).reduce(function (a, x) { return a + x.areaRai; }, 0);
    const next = (c.months.find(function (x) { return x.month === addMonth_(m, 1); }) || {}).areaRai || 0;
    return {
      subtitle: c.crop + ' ปีการผลิต ' + c.season + ' ข้อมูล ณ สิ้น' + ymText_(m),
      columns: [col_('item', 'รายการ'), col_('value', 'ค่า', 'number'), col_('unit', 'หน่วย')],
      rows: [
        { item: 'พื้นที่ปลูกทั้งหมด', value: round_(total, 2), unit: 'ไร่' },
        { item: 'เก็บเกี่ยวแล้ว ถึงสิ้น' + ymText_(m), value: round_(harvested, 2), unit: 'ไร่' },
        { item: 'สัดส่วนที่เก็บเกี่ยวแล้ว', value: pct_(harvested, total), unit: '%' },
        { item: 'คงเหลือยังไม่เก็บเกี่ยว', value: round_(total - harvested, 2), unit: 'ไร่' },
        { item: 'คาดว่าจะเก็บเกี่ยว ' + ymText_(addMonth_(m, 1)), value: round_(next, 2), unit: 'ไร่' },
        { item: 'ช่วงเดือนเก็บเกี่ยว', value: '', unit: ymText_(c.firstMonth) + ' – ' + ymText_(c.lastMonth) },
        { item: 'ชนิดเศษวัสดุ', value: '', unit: c.material || '–' }
      ],
      notes: ['ที่มา: ' + (getCropSummary_(false).source || 'ทะเบียนเกษตรกร') + ' นำเข้าเมื่อ ' + c.importedAt,
        'พื้นที่เก็บเกี่ยวเป็นค่าคาดการณ์ตามวันที่คาดว่าจะเก็บเกี่ยวในทะเบียนเกษตรกร']
    };
  },
  'crops.monthly': function (ctx) {
    const c = ctx.crop;
    const total = c.months.reduce(function (a, x) { return a + x.areaRai; }, 0);
    let cum = 0;
    return {
      subtitle: c.crop + ' ปีการผลิต ' + c.season,
      columns: [col_('month', 'เดือน'), col_('households', 'ครัวเรือน', 'number'), col_('plots', 'แปลง', 'number'), col_('area', 'เก็บเกี่ยว (ไร่)', 'number'),
        col_('cum', 'เก็บเกี่ยวสะสม (ไร่)', 'number'), col_('remaining', 'คงเหลือ (ไร่)', 'number'), col_('pct', 'สะสม (%)', 'number')],
      rows: c.months.map(function (x) {
        cum += x.areaRai;
        return { month: ymText_(x.month), households: x.households, plots: x.plots, area: round_(x.areaRai, 2), cum: round_(cum, 2), remaining: round_(total - cum, 2), pct: pct_(cum, total) };
      }),
      totals: { month: 'รวม', households: c.months.reduce(function (a, x) { return a + x.households; }, 0), plots: c.months.reduce(function (a, x) { return a + x.plots; }, 0), area: round_(total, 2) }
    };
  },
  'crops.districts': function (ctx) {
    const c = ctx.crop, m = ctx.asOf;
    const rows = c.byDistrict.map(function (d) {
      const h = cropHarvestedTo_(d.months, m);
      return { name: d.name, total: round_(d.totalRai, 2), harvested: round_(h, 2), remaining: round_(d.totalRai - h, 2), pct: pct_(h, d.totalRai),
        next: round_(Number(d.months[String(addMonth_(m, 1))]) || 0, 2) };
    }).sort(function (a, b) { return b.total - a.total; });
    const sum = function (k) { return round_(rows.reduce(function (a, r) { return a + r[k]; }, 0), 2); };
    return {
      subtitle: c.crop + ' ปีการผลิต ' + c.season + ' ข้อมูล ณ สิ้น' + ymText_(m),
      columns: [col_('name', 'อำเภอ'), col_('total', 'พื้นที่ปลูก (ไร่)', 'number'), col_('harvested', 'เก็บเกี่ยวแล้ว (ไร่)', 'number'),
        col_('remaining', 'คงเหลือ (ไร่)', 'number'), col_('pct', 'เก็บเกี่ยวแล้ว (%)', 'number'), col_('next', 'คาดเก็บเกี่ยว ' + ymText_(addMonth_(m, 1)) + ' (ไร่)', 'number')],
      rows: rows,
      totals: { name: 'รวมทั้งจังหวัด', total: sum('total'), harvested: sum('harvested'), remaining: sum('remaining'), pct: pct_(sum('harvested'), sum('total')), next: sum('next') }
    };
  },
  'crops.subdistricts': function (ctx) {
    const c = ctx.crop, m = ctx.asOf;
    const data = activeCropRows_();
    const rows = (data.rows[c.importId] || []).filter(function (r) { return r.level === 'subdistrict'; });
    const dnames = {};
    (data.rows[c.importId] || []).filter(function (r) { return r.level === 'district'; }).forEach(function (r) { dnames[r.code] = r.name; });
    const t = {};
    rows.forEach(function (r) {
      const x = t[r.code] || (t[r.code] = { code: r.code, district: dnames[r.code.slice(0, 5)] || r.code.slice(0, 5), name: r.name, months: {} });
      x.months[r.period] = (x.months[r.period] || 0) + r.area;
    });
    const out = Object.keys(t).sort().map(function (k) {
      const x = t[k];
      const total = Object.keys(x.months).reduce(function (a, p) { return a + x.months[p]; }, 0);
      const h = cropHarvestedTo_(x.months, m);
      return { district: x.district, name: x.name, code: x.code.replace(/-/g, ''), total: round_(total, 2), harvested: round_(h, 2), remaining: round_(total - h, 2), pct: pct_(h, total) };
    });
    return {
      subtitle: c.crop + ' ปีการผลิต ' + c.season + ' ข้อมูล ณ สิ้น' + ymText_(m),
      columns: [col_('district', 'อำเภอ'), col_('name', 'ตำบล'), col_('code', 'รหัส'), col_('total', 'พื้นที่ปลูก (ไร่)', 'number'),
        col_('harvested', 'เก็บเกี่ยวแล้ว (ไร่)', 'number'), col_('remaining', 'คงเหลือ (ไร่)', 'number'), col_('pct', 'เก็บเกี่ยวแล้ว (%)', 'number')],
      rows: out,
      notes: ['ผลรวมรายตำบลอาจต่างจากยอดอำเภอ/จังหวัดเล็กน้อยจากการปัดเศษในรายงานต้นทาง']
    };
  },
  'reports.status': function () {
    const r = getSmartAgriReports_(false);
    if (!r.ok) return smartAgriUnavailable_(r);
    const TH = { accepted: 'ตรวจรับแล้ว', submitted: 'ส่งแล้ว', draft: 'ยังไม่ส่ง (ร่าง)', returned: 'ส่งกลับแก้ไข', none: 'ยังไม่รายงาน' };
    return {
      subtitle: (r.round.label || '') + (r.round.start ? ' (' + r.round.start + ' ถึง ' + r.round.end + ', ครบกำหนด ' + r.round.due + ')' : ''),
      columns: [col_('name', 'อำเภอ'), col_('status', 'สถานะ'), col_('late', 'ส่งช้า')],
      rows: r.byDistrict.map(function (d) { return { name: d.name, status: TH[d.status] || d.status, late: d.late ? 'ใช่' : '' }; }),
      notes: ['ส่งรายงานแล้ว ' + r.reportedCount + ' จาก ' + r.districtsTotal + ' อำเภอ']
    };
  },
  'reports.indicators': function () {
    const r = getSmartAgriReports_(false);
    if (!r.ok) return smartAgriUnavailable_(r);
    const v = function (d, id, f) { const x = d.items[id]; return x && x[f] !== null && x[f] !== undefined ? x[f] : ''; };
    return {
      subtitle: 'ยอดสะสมถึง' + (r.round.label || 'ครั้งล่าสุด') + ' (เฉพาะรายงานที่ส่งแล้วหรือตรวจรับแล้ว)',
      columns: [col_('name', 'อำเภอ'), col_('r31', 'ไถกลบตอซัง/ใช้สารย่อยสลาย (ไร่)', 'number'), col_('r31w', 'ครั้งล่าสุด (ไร่)', 'number'),
        col_('r30', 'แปรรูปวัสดุ (หมู่บ้าน/ชุมชน)', 'number'), col_('r29', 'ส่งเสริมแทนการเผา (ครั้ง)', 'number')],
      rows: r.byDistrict.map(function (d) { return { name: d.name, r31: v(d, 'R31', 'cumulative'), r31w: v(d, 'R31', 'week'), r30: v(d, 'R30', 'cumulative'), r29: v(d, 'R29', 'cumulative') }; }),
      notes: ['ที่มา: KPP Smart Agri-Materials ช่องว่าง = ยังไม่มีรายงาน']
    };
  },
  'reports.series': function () {
    const r = getSmartAgriReports_(false);
    if (!r.ok) return smartAgriUnavailable_(r);
    const v = function (x, id, f) { const y = x.values[id]; return y && y[f] !== null && y[f] !== undefined ? y[f] : ''; };
    return {
      columns: [col_('label', 'ครั้งที่'), col_('period', 'ช่วงวันที่'), col_('reported', 'อำเภอที่รายงาน', 'number'),
        col_('r31', 'ไถกลบ/ย่อยสลาย สะสม (ไร่)', 'number'), col_('r30', 'แปรรูป สะสม', 'number'), col_('r29', 'ส่งเสริม สะสม', 'number')],
      rows: r.series.map(function (x) { return { label: x.label, period: x.start ? x.start + ' ถึง ' + x.end : '', reported: x.reported,
        r31: v(x, 'R31', 'cumulative'), r30: v(x, 'R30', 'cumulative'), r29: v(x, 'R29', 'cumulative') }; })
    };
  },
  'market.districts': function () {
    const p = getPublicSummary_(false);
    return {
      columns: [col_('name', 'อำเภอ'), col_('plots', 'แปลงพร้อมขาย', 'number'), col_('farmers', 'เกษตรกร (ราย)', 'number'), col_('area', 'พื้นที่ (ไร่)', 'number'),
        col_('buyers', 'จุดรับซื้อ', 'number'), col_('capacity', 'รับซื้อได้ (ตัน/วัน)', 'number')],
      rows: p.byDistrict.map(function (d) { return { name: d.name, plots: d.plots, farmers: d.farmers, area: d.areaRai, buyers: d.buyers, capacity: d.capacityTonPerDay }; }),
      totals: { name: 'รวม', plots: p.totals.farmerPlots, farmers: p.totals.farmers, area: p.totals.areaRai, buyers: p.totals.buyers, capacity: p.totals.capacityTonPerDay }
    };
  },
  'market.materials': function () {
    const p = getPublicSummary_(false);
    return {
      columns: [col_('material', 'ชนิดเศษวัสดุ'), col_('plots', 'แปลง', 'number'), col_('area', 'พื้นที่ (ไร่)', 'number'), col_('buyers', 'จุดรับซื้อ', 'number'),
        col_('capacity', 'รับซื้อได้ (ตัน/วัน)', 'number'), col_('price', 'ราคาเฉลี่ย (บาท/ไร่)', 'number')],
      rows: p.byMaterial.map(function (m) { return { material: m.material, plots: m.plots, area: m.areaRai, buyers: m.buyers, capacity: m.capacityTonPerDay, price: m.avgBuyerPriceBahtPerRai === null ? '' : m.avgBuyerPriceBahtPerRai }; })
    };
  },
  'market.plots': function (ctx) {
    const districts = districtList_();
    const rows = dataRows_(sheet_('farmers')).filter(function (r) { return String(r[11] || '').trim().toLowerCase() === 'open'; }).map(function (r) {
      const d = hasCoordinates_(r[9], r[10]) ? districtForPoint_(Number(r[9]), Number(r[10]), districts) : null;
      return { district: d ? d.name : 'ไม่ระบุ', name: (text_(r[2]) + ' ' + text_(r[3])).trim(), phone: ctx.unmask ? fullPhone_(r[4]) : maskPhone_(r[4]),
        crop: text_(r[5]), material: resolvedMaterial_(r[13], r[14], r[5]), area: text_(r[8]), areaRai: round_(parseAreaRai_(r[8]), 2),
        harvest: dateInput_(r[7]), lat: maybeNumber_(r[9]), lng: maybeNumber_(r[10]) };
    }).sort(function (a, b) { return a.district.localeCompare(b.district, 'th') || (a.harvest < b.harvest ? -1 : 1); });
    return {
      columns: [col_('district', 'อำเภอ'), col_('name', 'ชื่อ-สกุล'), col_('phone', 'โทรศัพท์'), col_('crop', 'พืช'), col_('material', 'เศษวัสดุ'),
        col_('area', 'พื้นที่'), col_('areaRai', 'ไร่', 'number'), col_('harvest', 'วันเก็บเกี่ยว'), col_('lat', 'ละติจูด', 'number'), col_('lng', 'ลองจิจูด', 'number')],
      rows: rows,
      notes: ['ข้อมูลส่วนบุคคล ใช้ตามวัตถุประสงค์ที่เกษตรกรให้ความยินยอมเท่านั้น' + (ctx.unmask ? '' : ' (ปิดบังเบอร์โทร)')]
    };
  },
  'market.buyers': function (ctx) {
    const districts = districtList_();
    const rows = dataRows_(sheet_('buyers')).filter(function (r) { return String(r[11] || '').trim().toLowerCase() === 'active'; }).map(function (r) {
      const d = hasCoordinates_(r[5], r[6]) ? districtForPoint_(Number(r[5]), Number(r[6]), districts) : null;
      return { district: d ? d.name : 'ไม่ระบุ', name: (text_(r[2]) + ' ' + text_(r[3])).trim(), phone: ctx.unmask ? fullPhone_(r[4]) : maskPhone_(r[4]),
        material: resolvedMaterial_(r[13], r[14], r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10]), lat: maybeNumber_(r[5]), lng: maybeNumber_(r[6]) };
    }).sort(function (a, b) { return a.district.localeCompare(b.district, 'th'); });
    return {
      columns: [col_('district', 'อำเภอ'), col_('name', 'ชื่อจุดรับซื้อ'), col_('phone', 'โทรศัพท์'), col_('material', 'รับซื้อ'), col_('quality', 'คุณภาพ'),
        col_('price', 'ราคา (บาท/ไร่)', 'number'), col_('capacity', 'ปริมาณ (ตัน/วัน)'), col_('lat', 'ละติจูด', 'number'), col_('lng', 'ลองจิจูด', 'number')],
      rows: rows,
      notes: ['ข้อมูลส่วนบุคคล ใช้ตามวัตถุประสงค์ที่ผู้รับซื้อให้ความยินยอมเท่านั้น' + (ctx.unmask ? '' : ' (ปิดบังเบอร์โทร)')]
    };
  },
  'visits.monthly': function () {
    const m = {};
    visitDaily_().forEach(function (d) { const k = d.date.slice(0, 7); m[k] = (m[k] || 0) + d.visits; });
    const rows = Object.keys(m).sort().map(function (k) { return { month: ymText_(Number(k.replace('-', ''))), visits: m[k] }; });
    const c = visitCounts_(true);
    return { columns: [col_('month', 'เดือน'), col_('visits', 'จำนวนการเข้าชม', 'number')], rows: rows,
      totals: { month: 'รวมทั้งหมด (รวมยอดก่อนเริ่มเก็บรายวัน)', visits: c.total },
      notes: ['นับ 1 ครั้งต่อการเปิดใช้งาน (session) ไม่ใช่จำนวนคนไม่ซ้ำ'] };
  },
  'visits.daily': function () {
    const rows = visitDaily_().slice(-90).map(function (d) { return { date: d.date, visits: d.visits }; });
    return { columns: [col_('date', 'วันที่'), col_('visits', 'จำนวนการเข้าชม', 'number')], rows: rows };
  },
  'audit.imports': function () {
    const TH = { active: 'ใช้งาน', replaced: 'ถูกแทนที่', deleted: 'ลบแล้ว' };
    return {
      columns: [col_('importedAt', 'นำเข้าเมื่อ'), col_('crop', 'พืช'), col_('season', 'ปีการผลิต'), col_('totalRai', 'ไร่', 'number'), col_('rows', 'แถว', 'number'),
        col_('periods', 'ช่วงเดือน'), col_('status', 'สถานะ'), col_('importedBy', 'โดย'), col_('fileName', 'ไฟล์')],
      rows: cropImportsList_().map(function (x) { return { importedAt: x.importedAt, crop: x.crop, season: x.season, totalRai: x.totalRai, rows: x.rows, periods: x.periods, status: TH[x.status] || x.status, importedBy: x.importedBy, fileName: x.fileName }; })
    };
  },
  'audit.log': function () {
    return {
      columns: [col_('time', 'เวลา'), col_('username', 'ผู้ใช้'), col_('name', 'ชื่อ'), col_('role', 'บทบาท'), col_('action', 'การกระทำ'), col_('detail', 'รายละเอียด')],
      rows: adminLogList_()
    };
  }
};

function smartAgriUnavailable_(r) {
  return { columns: [col_('message', 'หมายเหตุ')], rows: [{ message: 'ยังดึงข้อมูลจากระบบรายงานอำเภอไม่ได้: ' + (r.error || '') }] };
}
