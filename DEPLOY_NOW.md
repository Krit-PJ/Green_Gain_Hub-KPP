# Deploy Green Gain Hub 4.2.0

สถานะ 25 พ.ย. 2569: **Deploy แล้ว** (ดูเลขเวอร์ชันล่าสุดในประวัติด้านล่าง)

> 2.9.2 (ลองใหม่อัตโนมัติเมื่อเชื่อมต่อหลุด) และ 2.9.1 เปลี่ยนเฉพาะหน้าเว็บ (สีและตัวอักษรอ่านง่ายขึ้น) — GitHub Pages deploy เอง ไม่ต้องแก้หรือ Deploy Apps Script (เวอร์ชัน 16 ในตอนนั้น)

- Apps Script: **Green Gain Hub KPP API** (`1JfUtXCoOvrb_Nz2N6xgRBSiT72DSWV92pFepA20eNcGb8WUhDNuRLLSg`, บัญชี noonoy.cmu@gmail.com)
- Deployment `AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT` (Execute as: Me, Access: Anyone)
  - เวอร์ชัน 24 = 4.2.0 การ์ดผู้ใช้งานแก้ไขได้ + รัศมีคู่ค้าตั้งค่าได้ + แดชบอร์ดเจ้าหน้าที่ (Code.gs + Admin.gs) · 23 = 4.1.0 รัศมี 50 กม. ข้ามจังหวัด (Code.gs) · 22 = 4.0.0 เจ้าหน้าที่ของ GGH เอง (ไฟล์ใหม่ Admin.gs + Reports.gs, ลบ Sso.gs, Code.gs + Market.gs) · 21 = 3.3.0 เข้าสู่ระบบด้วยเบอร์อย่างเดียว (Code.gs + ไฟล์ใหม่ Sales.gs แทน Pin.gs ที่ลบแล้ว) · 20 = 3.2.0 รายงานผู้บริหารให้ ABM (Market.gs + Code.gs) · 19 = 3.1.0 PIN + ขายแล้ว (ไฟล์ใหม่ Pin.gs + Code.gs) · 18 = 3.0.0 ทุกจังหวัด (ไฟล์ใหม่ Geo.gs + Code.gs + Market.gs) · 17 = 2.9.3 เข้าสู่ระบบด้วยเบอร์ที่ GGH โดยตรง ไม่ถูกปิดด้วย SSO_MODE (Code.gs) · 16 = 2.9.0 feed marketPhones (Code.gs + Sso.gs) · 15 = 2.8.0 ซ่อนแปลงหลังเก็บเกี่ยว N วัน (Market.gs + Code.gs) · 14 = 2.7.0 หน้าตลาดแบบ Dashboard (Market.gs + Code.gs) · 13 = 2.6.0 ตลาดอย่างเดียว (แยกส่วนเจ้าหน้าที่ไป ABM) · 12 = 2.5.1 feed สำหรับ ABM · 11 = 2.5.0 หน้าแรกตลาด · 10 = 2.4.0 ตัวตนกลาง
- ABM (ระบบเจ้าหน้าที่): repo `KPP-Agri-Byproduct-Management`, Apps Script `1ZRd2SmPDj6yKB3MuQe7tW1yOMfZwBFULjIDOCnN-hH-YcsqPT6CieYe8`

> ⚠️ `AKfycbxoo4…` เป็นของระบบ **KPP Smart Agri-Materials v2** ห้ามวางโค้ด GGH หรือ Deploy ทับ

## ไฟล์ในโปรเจกต์ Apps Script (4.0.0)

`Code.gs` (ในตัวแก้ไขภาษาไทยชื่อ "รหัส.gs"), `Districts.gs`, `Counter.gs`, `Market.gs`, `Abm.gs`, `Geo.gs` (3.0.0), `Sales.gs` (3.3.0 — แทน `Pin.gs` ของ 3.1.0), `Admin.gs` + `Reports.gs` (4.0.0) · `Sso.gs` ลบแล้วใน 4.0.0

> 4.0.0 Super Admin คนแรก: เจ้าของบัญชีตั้ง Script Properties `SUPER_ADMIN_USERNAME` และ `SUPER_ADMIN_PASSWORD` เอง แล้ว Run `setupSystem()` — ระบบเก็บเฉพาะค่าแฮชในชีต `ggh_admins` และลบ `SUPER_ADMIN_PASSWORD` ทิ้งทันที · Admin จังหวัดสมัครที่ `admin.html#register` แล้วรอ Super Admin อนุมัติ

> 3.0.0 ลำดับ: GitHub Pages ก่อน (ไฟล์ `geo/` ต้องออนไลน์ เพราะเซิร์ฟเวอร์อ่านขอบเขตจากหน้าเว็บ) → เพิ่มไฟล์ `Geo.gs` + วาง Code.gs/Market.gs → Deploy เวอร์ชันใหม่ · การเติมจังหวัดข้อมูลเดิมทำเองในคำขอแรก (หรือ Run `migrateProvinces()`) · ตรวจ `verifyGeo()``

## อัปเดตโค้ดครั้งถัดไป

1. ตรวจว่าโค้ดในตัวแก้ไขตรงกับ `main` แล้ววางไฟล์ที่เปลี่ยน → บันทึก → โหลดหน้าใหม่ตรวจอีกครั้ง
2. Run `setupSystem()` (บรรทัดสุดท้ายแสดงการเชื่อม ABM)
3. **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > ✏️ แก้ไข** > **เวอร์ชันใหม่** > ทำให้ใช้งานได้ (URL เดิม)
4. ตรวจ `…/exec?api=v1&endpoint=health` (feature `MARKET_ONLY`) และ `…/exec?api=v1&endpoint=market&refresh=1`

## Script Properties

| Property | ค่า | จำเป็น |
| --- | --- | --- |
| `SMART_AGRI_API_KEY` | 2.6.0: ไม่ใช้แล้ว (รายงานอำเภออยู่ที่ ABM) — ลบได้ และยกเลิกคีย์ `kpp_fa4750…` ในระบบ Smart Agri หลัง ABM ใส่คีย์ของตัวเองแล้ว | ไม่ |
| `ABM_API_URL` | URL `/exec` ของ ABM ถ้าเปลี่ยน Deployment | ไม่ |
| `SPREADSHEET_ID` | ใช้ Sheet อื่นแทนค่าเริ่มต้น | ไม่ |
| `SUMMARY_API_KEY` | บังคับ key สำหรับ summary ของ GGH | ไม่ |
| `SUPER_ADMIN_USERNAME` | ชื่อผู้ใช้ Super Admin คนแรก (3–32 ตัว a–z 0–9 . _ -) ถ้าไม่มีจะอ่านจาก `SUPER_ADMIN_PHONE` | ครั้งแรกเท่านั้น |
| `SUPER_ADMIN_PASSWORD` | รหัสผ่านเริ่มต้นของ Super Admin (อย่างน้อย 8 ตัว) ระบบลบออกอัตโนมัติหลัง Run `setupSystem()` | ครั้งแรก หรือเมื่อลืมรหัสผ่าน |

ถ้าคีย์ Smart Agri ถูกยกเลิกหรือหมดอายุ หน้าแรกยังทำงาน แต่ส่วนรายงานจะแสดง "ยังโหลดข้อมูลรายงานไม่ได้" ให้สร้างคีย์ใหม่แล้วแก้ Script Property

## หลังสลับระบบ

- Archive Deployment เดิม `AKfycbwQLS…` (ยังเขียนลง Sheet เดิม) เพื่อไม่ให้ข้อมูลแยกสองที่
- ตรวจหน้าเว็บแบบ Incognito: หน้าแรกแสดงข้อมูลรายงานและตลาด, เข้าสู่ระบบด้วยเบอร์เดิมได้

## ผู้ดูแลระบบ (1.6.0)

1. ตั้ง Script Properties `SUPER_ADMIN_USERNAME` และ `SUPER_ADMIN_PASSWORD`
2. Run `setupSystem()` (ระบบจะสร้างชีต admins/crop_* และ Super Admin แล้วลบ `SUPER_ADMIN_PASSWORD` ทิ้ง)
3. เข้า `admin.html` (ลิงก์ "สำหรับเจ้าหน้าที่" ใต้กล่องเข้าสู่ระบบ) แล้วเปลี่ยนรหัสผ่านที่เมนู "บัญชีของฉัน"
4. เพิ่ม Admin คนอื่นที่เมนู "ผู้ดูแลระบบ"

ลืมรหัสผ่าน Super Admin: ตั้ง `SUPER_ADMIN_USERNAME`/`SUPER_ADMIN_PASSWORD` ใหม่ แล้ว Run `setupSystem()` อีกครั้ง
