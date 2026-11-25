/**
 * Green Gain Hub 4.0.0 — officers' reports (Admin: own province · Super Admin: any province or all).
 * Printed like Agri-Risk Map Burning: A4 landscape, a header (province, scope, period, data date, print date), a map fitted
 * to the province with its districts shaded by the main figure, then full tables (every district, zeros included).
 * Facts are labelled apart from estimates; costs are not collected. No names, phones or coordinates in any report.
 */
const GREPORT_SECTIONS = [
  { key: 'summary', title: 'สรุปภาพรวม', desc: 'ผู้ลงทะเบียน แปลงประกาศขาย พื้นที่ ชีวมวล ผู้รับซื้อ มูลค่าที่เป็นไปได้ และการขายจริง' },
  { key: 'areas', title: 'รายอำเภอ (รายจังหวัดเมื่อเลือกทุกจังหวัด)', desc: 'ครบทุกพื้นที่ รวมพื้นที่ที่ยังไม่มีข้อมูล' },
  { key: 'materials', title: 'รายชนิดวัสดุเหลือใช้ทางการเกษตร', desc: 'พื้นที่ ชีวมวล ราคาเสนอซื้อ การขายจริง' },
  { key: 'harvest', title: 'ปฏิทินเก็บเกี่ยว (รายเดือน)', desc: 'ใช้วางแผนรถอัดฟางและการรับซื้อ' },
  { key: 'sales', title: 'การขายจริงที่เกษตรกรบันทึก', desc: 'ตามช่วงวันที่ที่เลือก ไม่มีชื่อและเบอร์โทร' },
  { key: 'registrations', title: 'ผู้ลงทะเบียนรายเดือน', desc: 'เกษตรกรและผู้รับซื้อ ตามช่วงวันที่ที่เลือก' },
  { key: 'audit', title: 'ประวัติการใช้งานของเจ้าหน้าที่', desc: 'Super Admin เท่านั้น (300 รายการล่าสุดในช่วงที่เลือก)', role: 'super' }
];
const GREPORT_TYPES = [
  { key: 'province', title: 'รายงานจังหวัด (ผู้บริหาร)', sections: ['summary', 'areas', 'materials', 'harvest', 'sales'] },
  { key: 'market', title: 'สถานการณ์ตลาดวันนี้', sections: ['summary', 'areas', 'materials'] },
  { key: 'plan', title: 'วางแผนเก็บเกี่ยวและรับซื้อ', sections: ['harvest', 'areas'] },
  { key: 'users', title: 'ผู้ใช้งานและการขาย', sections: ['registrations', 'sales'] },
  { key: 'audit', title: 'ตรวจสอบการใช้งานเจ้าหน้าที่', sections: ['audit'], role: 'super' }
];

function reportCatalog_(s) {
  const ok = function (x) { return !x.role || x.role === s.role; };
  return { status: 'success', sections: GREPORT_SECTIONS.filter(ok), types: GREPORT_TYPES.filter(ok), allProvinces: s.role === 'super',
    province: s.province, provinceName: s.provinceName, provinces: adminProvinces_(s) };
}

function gcol_(key, label, type) { return { key: key, label: label, type: type || 'text' }; }
const GFACT = 'ข้อมูลจริง', GEST = 'ประมาณการ';
function gMonthText_(ym) {
  if (ym === 'done') return 'เลยวันเก็บเกี่ยวแล้ว (ยังแสดงบนตลาด)';
  if (ym === 'none') return 'ไม่ระบุวันเก็บเกี่ยว';
  const m = String(ym).match(/^(\d{4})-(\d{2})$/);
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return m ? TH[Number(m[2]) - 1] + ' ' + (Number(m[1]) + 543) : String(ym);
}

function reportData_(input, s) {
  input = input || {};
  const scope = adminScope_(s, input.province, true);
  const allowed = {}; reportCatalog_(s).sections.forEach(function (x) { allowed[x.key] = x; });
  const keys = (Array.isArray(input.sections) ? input.sections : []).filter(function (k) { return allowed[k]; });
  if (!keys.length) throw new Error('กรุณาเลือกหัวข้อรายงานอย่างน้อย 1 หัวข้อ');
  const from = input.from ? dateInput_(toDate_(input.from)) : '', to = input.to ? dateInput_(toDate_(input.to)) : '';
  if (input.from && !from) throw new Error('วันที่เริ่มไม่ถูกต้อง');
  if (input.to && !to) throw new Error('วันที่สิ้นสุดไม่ถูกต้อง');
  if (from && to && from > to) throw new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  const rep = marketReport_(scope, from, to);
  // every district of the province (zeros included), so the printed table is complete like Agri-Risk Map
  if (rep.scope.by === 'district') {
    try {
      const have = {}; rep.areas.forEach(function (a) { have[a.code] = true; });
      const geo = geoProvince_(scope);
      ((geo && geo.districts) || []).forEach(function (d) {
        if (!have[d.code]) rep.areas.push({ code: d.code, name: d.name, farmers: 0, plots: 0, areaRai: 0, ton: 0, buyers: 0, capacityTonPerDay: 0, potentialBaht: 0, salesCount: 0, salesBaht: 0, salesTon: 0 });
      });
    } catch (err) { /* boundary file unreachable: districts with data only */ }
  }
  const ctx = { s: s, scope: scope, rep: rep, from: from, to: to };
  const sections = keys.map(function (k) { return Object.assign({ key: k, title: allowed[k].title }, GREPORT_BUILDERS[k](ctx)); });
  gadminAudit_(s, 'report_view', 'รายงาน ' + rep.scope.name + ': ' + keys.join(', ') + (from || to ? ' ช่วง ' + (from || '…') + '–' + (to || '…') : ''));
  return {
    status: 'success', title: cleanText_(input.title, 150) || 'รายงานตลาดวัสดุเหลือใช้ทางการเกษตร Green Gain Hub',
    scope: rep.scope, period: { from: from, to: to }, generatedAt: rep.generatedAt, by: s.name + ' (' + gadminRoleLabel_(s.role) + ')',
    map: { province: scope === 'ALL' ? '' : scope, by: rep.scope.by, values: rep.areas.map(function (a) { return { code: a.code, name: a.name, areaRai: a.areaRai, plots: a.plots, buyers: a.buyers }; }) },
    summary: rep.summary, notes: rep.notes, listing: rep.listing, sections: sections
  };
}

const GREPORT_BUILDERS = {
  summary: function (c) {
    const x = c.rep.summary;
    const rows = [
      ['เกษตรกรที่ลงทะเบียน', x.usersFarmers, 'ราย', GFACT], ['ผู้รับซื้อที่ลงทะเบียน', x.usersBuyers, 'ราย', GFACT],
      ['เกษตรกรที่มีแปลงประกาศขาย', x.farmers, 'ราย', GFACT], ['แปลงประกาศขาย (แสดงบนตลาดวันนี้)', x.plots, 'แปลง', GFACT],
      ['พื้นที่ประกาศขาย', x.areaRai, 'ไร่', GFACT], ['ชีวมวลที่คาดว่าจะได้', x.ton, 'ตัน', GEST],
      ['จุดรับซื้อที่เปิดรับ', x.buyers, 'จุด', GFACT], ['ความสามารถรับซื้อรวม', x.capacityTonPerDay, 'ตัน/วัน', GFACT],
      ['มูลค่าที่เป็นไปได้ของแปลงประกาศขาย', x.potentialBaht, 'บาท', GEST], ['การขายจริง (เกษตรกรกด "ขายแล้ว")', x.salesCount, 'ครั้ง', GFACT],
      ['ปริมาณที่ขายแล้ว', x.salesTon, 'ตัน', GFACT], ['รายได้จากการขายจริง', x.salesBaht, 'บาท', GFACT]
    ];
    if (x.provincesActive !== null && x.provincesActive !== undefined) rows.splice(2, 0, ['จังหวัดที่มีการใช้งาน', x.provincesActive, 'จังหวัด', GFACT]);
    return { columns: [gcol_('item', 'รายการ'), gcol_('value', 'ค่า', 'number'), gcol_('unit', 'หน่วย'), gcol_('kind', 'ประเภทข้อมูล')],
      rows: rows.map(function (r) { return { item: r[0], value: r[1], unit: r[2], kind: r[3] }; }),
      notes: [c.rep.notes.facts, c.rep.notes.estimates, c.rep.notes.sales, c.rep.notes.costs] };
  },
  areas: function (c) {
    const byP = c.rep.scope.by === 'province';
    const rows = c.rep.areas.slice().sort(function (a, b) { return b.areaRai - a.areaRai || b.buyers - a.buyers || a.name.localeCompare(b.name, 'th'); })
      .map(function (a, i) { return { no: i + 1, name: a.name, farmers: a.farmers, plots: a.plots, area: a.areaRai, ton: a.ton, buyers: a.buyers, capacity: a.capacityTonPerDay, potential: a.potentialBaht, salesBaht: a.salesBaht }; });
    const sum = function (k) { return round_(rows.reduce(function (t, r) { return t + (Number(r[k]) || 0); }, 0), 2); };
    return { landscape: true,
      columns: [gcol_('no', 'ลำดับ', 'number'), gcol_('name', byP ? 'จังหวัด' : 'อำเภอ'), gcol_('farmers', 'เกษตรกรผู้ขาย (ราย)', 'number'), gcol_('plots', 'แปลง', 'number'),
        gcol_('area', 'พื้นที่ (ไร่)', 'number'), gcol_('ton', 'ชีวมวล ประมาณการ (ตัน)', 'number'), gcol_('buyers', 'ผู้รับซื้อ (จุด)', 'number'),
        gcol_('capacity', 'รับซื้อได้ (ตัน/วัน)', 'number'), gcol_('potential', 'มูลค่าที่เป็นไปได้ (บาท)', 'number'), gcol_('salesBaht', 'รายได้จริง (บาท)', 'number')],
      rows: rows,
      totals: { no: '', name: 'รวม', farmers: c.rep.summary.farmers, plots: sum('plots'), area: sum('area'), ton: sum('ton'), buyers: sum('buyers'), capacity: sum('capacity'), potential: sum('potential'), salesBaht: sum('salesBaht') },
      notes: ['ครบทุก' + (byP ? 'จังหวัดที่มีข้อมูล' : 'อำเภอ') + ' · ยอดรวมเกษตรกรนับคนไม่ซ้ำ · ชีวมวลและมูลค่าที่เป็นไปได้เป็นค่าประมาณการ'] };
  },
  materials: function (c) {
    return { columns: [gcol_('material', 'วัสดุเหลือใช้ทางการเกษตร'), gcol_('plots', 'แปลง', 'number'), gcol_('area', 'พื้นที่ (ไร่)', 'number'), gcol_('ton', 'ชีวมวล ประมาณการ (ตัน)', 'number'),
      gcol_('buyers', 'ผู้รับซื้อ (จุด)', 'number'), gcol_('price', 'ราคาเสนอซื้อเฉลี่ย (บาท/ไร่)', 'number'), gcol_('potential', 'มูลค่าที่เป็นไปได้ (บาท)', 'number'),
      gcol_('salesTon', 'ขายจริง (ตัน)', 'number'), gcol_('salesBaht', 'รายได้จริง (บาท)', 'number')],
      rows: c.rep.materials.map(function (m) { return { material: m.name, plots: m.plots, area: m.areaRai, ton: m.ton, buyers: m.buyers, price: m.avgPriceBahtPerRai === null || m.avgPriceBahtPerRai === undefined ? '' : m.avgPriceBahtPerRai, potential: m.potentialBaht, salesTon: m.salesTon, salesBaht: m.salesBaht }; }),
      notes: ['ราคาเสนอซื้อเฉลี่ยมาจากราคาที่ผู้รับซื้อแจ้ง ช่องว่าง = ยังไม่มีผู้รับซื้อแจ้งราคา'] };
  },
  harvest: function (c) {
    return { columns: [gcol_('month', 'เดือนที่เก็บเกี่ยว'), gcol_('plots', 'แปลง', 'number'), gcol_('area', 'พื้นที่ (ไร่)', 'number'), gcol_('ton', 'ชีวมวล ประมาณการ (ตัน)', 'number')],
      rows: c.rep.harvest.map(function (h) { return { month: gMonthText_(h.month), plots: h.plots, area: h.areaRai, ton: h.ton }; }),
      totals: { month: 'รวม', plots: c.rep.summary.plots, area: c.rep.summary.areaRai, ton: c.rep.summary.ton },
      notes: ['เฉพาะแปลงที่แสดงบนตลาดวันนี้ วันเก็บเกี่ยวมาจากเกษตรกรกรอกเอง'] };
  },
  sales: function (c) {
    const byP = c.rep.scope.by === 'province';
    const rows = c.rep.sales.map(function (x) { return { date: x.date, area: x.area, material: x.material, rai: x.areaRai, ton: x.ton, baht: x.baht, perTon: x.bahtPerTon }; });
    return { landscape: true,
      columns: [gcol_('date', 'วันที่ขาย'), gcol_('area', byP ? 'จังหวัด' : 'อำเภอ'), gcol_('material', 'วัสดุเหลือใช้ทางการเกษตร'), gcol_('rai', 'พื้นที่ (ไร่)', 'number'),
        gcol_('ton', 'ปริมาณ (ตัน)', 'number'), gcol_('baht', 'รายได้ (บาท)', 'number'), gcol_('perTon', 'ราคา (บาท/ตัน)', 'number')],
      rows: rows, empty: 'ยังไม่มีการบันทึกการขายในช่วงนี้',
      totals: rows.length ? { date: 'รวม', rai: c.rep.summary.salesAreaRai, ton: c.rep.summary.salesTon, baht: c.rep.summary.salesBaht } : null,
      notes: [c.rep.notes.sales + (c.rep.sales.length >= 500 ? ' · แสดง 500 รายการล่าสุด (ยอดรวมนับทุกรายการ)' : '')] };
  },
  registrations: function (c) {
    const m = {};
    dataRows_(sheet_('users')).forEach(function (r) {
      if (!inScope_(c.scope, text_(r[USER_GEO_COL - 1]) || DEFAULT_PROVINCE_CODE)) return;
      const d = toDate_(r[7]); const ymd = d ? dateInput_(d) : '';
      if ((c.from && ymd && ymd < c.from) || (c.to && ymd && ymd > c.to)) return;
      const k = d ? ymd.slice(0, 7) : 'none';
      const x = m[k] || (m[k] = { farmer: 0, buyer: 0 }); x[normalizeRole_(r[2]) === 'buyer' ? 'buyer' : 'farmer']++;
    });
    const rows = Object.keys(m).sort().map(function (k) { return { month: k === 'none' ? 'ไม่ระบุวันที่' : gMonthText_(k), farmers: m[k].farmer, buyers: m[k].buyer, total: m[k].farmer + m[k].buyer }; });
    const t = rows.reduce(function (a, r) { return { farmers: a.farmers + r.farmers, buyers: a.buyers + r.buyers }; }, { farmers: 0, buyers: 0 });
    return { columns: [gcol_('month', 'เดือนที่ลงทะเบียน'), gcol_('farmers', 'เกษตรกร (ราย)', 'number'), gcol_('buyers', 'ผู้รับซื้อ (ราย)', 'number'), gcol_('total', 'รวม (ราย)', 'number')],
      rows: rows, empty: 'ไม่มีผู้ลงทะเบียนในช่วงนี้', totals: { month: 'รวม', farmers: t.farmers, buyers: t.buyers, total: t.farmers + t.buyers },
      notes: ['นับผู้ใช้ที่ยังอยู่ในระบบ (ผู้ใช้ที่ถูกลบไม่นับ)'] };
  },
  audit: function (c) {
    const rows = dataRows_(ensureSheet_('ggh_admin_log', GADMIN_SHEETS.ggh_admin_log)).filter(function (r) {
      if (c.scope !== 'ALL' && text_(r[4]) !== c.scope) return false;
      const ymd = toDate_(r[0]) ? dateInput_(toDate_(r[0])) : '';
      return !((c.from && ymd && ymd < c.from) || (c.to && ymd && ymd > c.to));
    }).slice(-300).reverse().map(function (r) { return { time: dateTime_(r[0]), user: text_(r[1]) + (text_(r[2]) ? ' · ' + text_(r[2]) : ''), role: gadminRoleLabel_(text_(r[3])), action: text_(r[5]), detail: text_(r[6]) }; });
    return { landscape: true, columns: [gcol_('time', 'เวลา'), gcol_('user', 'ผู้ใช้'), gcol_('role', 'บทบาท'), gcol_('action', 'การกระทำ'), gcol_('detail', 'รายละเอียด')],
      rows: rows, empty: 'ไม่มีประวัติในช่วงนี้', notes: ['บันทึกทุกครั้งที่เจ้าหน้าที่ดูข้อมูลส่วนบุคคล แก้ไข หรือพิมพ์รายงาน'] };
  }
};
