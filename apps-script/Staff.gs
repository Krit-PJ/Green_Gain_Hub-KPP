/**
 * Green Gain Hub 2.1.0 — officer self-registration and phone sign-in (owner's choice).
 *
 * Officers of สำนักงานเกษตรอำเภอ / สำนักงานเกษตรจังหวัด register with name, phone,
 * office, group (provincial office), district and province, and are signed in at once.
 * They sign in again with the phone number only. Safeguards kept with that choice:
 *   - a self-registered account is always role "admin" (never Mini Super Admin / Super Admin)
 *   - district office → one district; provincial office → records any district but edits only its own records
 *   - one account per phone; Mini Super Admin / Super Admin cannot sign in by phone
 *   - every registration and sign-in is written to admin_log; Super/Mini can disable an account at once
 */

const STAFF_OFFICE_TYPES = { district: 'สำนักงานเกษตรอำเภอ', province: 'สำนักงานเกษตรจังหวัด' };
const STAFF_DEFAULT_GROUPS = ['กลุ่มอารักขาพืช', 'กลุ่มยุทธศาสตร์และสารสนเทศ', 'กลุ่มส่งเสริมและพัฒนาการผลิต', 'กลุ่มส่งเสริมและพัฒนาเกษตรกร'];
const STAFF_MAX_FAILS = 8;
const THAI_PROVINCES = ['กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
  'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์',
  'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา',
  'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด',
  'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี',
  'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'];

function staffGroups_() {
  const v = configValue_('staff_groups', '');
  const list = v ? v.split('|').map(function (g) { return g.trim(); }).filter(Boolean) : [];
  return list.length ? list : STAFF_DEFAULT_GROUPS.slice();
}

function staffOfficeLabel_(a) {
  if (a.role !== 'admin') return roleLabel_(a.role);
  if (a.officeType === 'province') return STAFF_OFFICE_TYPES.province + provinceName_() + (a.group ? ' (' + a.group + ')' : '');
  const name = residueDistrictNames_()[a.district];
  return STAFF_OFFICE_TYPES.district + (name || '');
}

/** Public: what the registration form needs. */
function staffMeta_() {
  const names = residueDistrictNames_();
  return { status: 'success', province: provinceName_(), provinces: THAI_PROVINCES, officeTypes: STAFF_OFFICE_TYPES, groups: staffGroups_(),
    districts: Object.keys(names).sort().map(function (c) { return { code: c, name: names[c] }; }) };
}

function staffFindByPhone_(phone) {
  const rows = dataRows_(sheetByName_('admins'));
  for (let i = 0; i < rows.length; i++) if (normalizePhone_(rows[i][10]) === phone) return adminRecord_(normalizeUsername_(rows[i][0]));
  return null;
}

function staffRegister_(input) {
  input = input || {};
  const name = cleanText_(input.name, 120);
  const phone = normalizePhone_(input.phone);
  const officeType = String(input.officeType || '');
  const province = cleanText_(input.province, 60).replace(/^จังหวัด/, '');
  if (name.length < 4 || !/\s/.test(name)) throw new Error('กรุณากรอกชื่อและนามสกุล');
  if (!/^0\d{9}$/.test(phone)) throw new Error('หมายเลขโทรศัพท์ต้องมี 10 หลัก');
  if (!STAFF_OFFICE_TYPES[officeType]) throw new Error('กรุณาเลือกหน่วยงาน');
  if (THAI_PROVINCES.indexOf(province) < 0) throw new Error('กรุณาเลือกจังหวัดจากรายการ');
  if (province !== provinceName_()) throw new Error('ระบบยังเปิดให้บริการเฉพาะจังหวัด' + provinceName_());
  const names = residueDistrictNames_();
  let district = '', group = '';
  if (officeType === 'district') {
    district = String(input.district || '');
    if (!names[district]) throw new Error('กรุณาเลือกอำเภอ');
  } else {
    group = cleanText_(input.group, 80);
    if (staffGroups_().indexOf(group) < 0) throw new Error('กรุณาเลือกกลุ่มของสำนักงานเกษตรจังหวัด');
    if (input.district && names[String(input.district)]) district = String(input.district);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let account;
  try {
    if (staffFindByPhone_(phone)) throw new Error('หมายเลขนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบด้วยหมายเลขโทรศัพท์');
    let username = 'p' + phone, n = 1;
    while (findAdminRow_(username)) username = 'p' + phone + '-' + (++n);
    const now = new Date();
    const sh = sheetByName_('admins');
    sh.appendRow([username, name, 'admin', 'active', '', '', now, 'ลงทะเบียนเอง', '', now, phone, district, officeType, group, province, 'self']);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
    sh.getRange(sh.getLastRow(), 11, 1, 2).setNumberFormat('@');
    account = adminRecord_(username);
  } finally {
    lock.releaseLock();
  }
  const out = adminIssueSession_(account, 'staff_register', 'ลงทะเบียนเจ้าหน้าที่: ' + name + ' ' + maskPhone_(phone) + ' ' + staffOfficeLabel_(account));
  out.message = 'ลงทะเบียนแล้ว เข้าใช้งานได้ทันที ครั้งต่อไปเข้าสู่ระบบด้วยหมายเลขโทรศัพท์';
  return out;
}

function staffLogin_(input) {
  const phone = normalizePhone_(input && input.phone);
  if (!/^0\d{9}$/.test(phone)) throw new Error('หมายเลขโทรศัพท์ต้องมี 10 หลัก');
  const cache = CacheService.getScriptCache();
  const failKey = 'sfail:' + phone;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= STAFF_MAX_FAILS) throw new Error('ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  const a = staffFindByPhone_(phone);
  if (!a || a.status !== 'active') {
    cache.put(failKey, String(fails + 1), ADMIN_LOCK_SECONDS);
    if (!a && dataRows_(sheet_('users')).some(function (r) { return normalizePhone_(r[0]) === phone; })) {
      throw new Error('MARKET_ACCOUNT: หมายเลขนี้ลงทะเบียนเป็นเกษตรกรหรือผู้รับซื้อ กรุณาเข้าสู่ระบบที่หน้าแรก');
    }
    throw new Error(a ? 'บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ' : 'ไม่พบหมายเลขนี้ กรุณาลงทะเบียนเจ้าหน้าที่ก่อน');
  }
  if (a.role !== 'admin') throw new Error('บัญชี ' + roleLabel_(a.role) + ' เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน');
  cache.remove(failKey);
  return adminIssueSession_(a, 'login', 'เข้าสู่ระบบด้วยหมายเลขโทรศัพท์');
}
