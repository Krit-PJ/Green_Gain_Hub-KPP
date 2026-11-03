# Deploy Green Gain Hub 1.7.0

สถานะ 3 พ.ย. 2569: **Deploy แล้ว**

- Apps Script: **Green Gain Hub KPP API** (`1JfUtXCoOvrb_Nz2N6xgRBSiT72DSWV92pFepA20eNcGb8WUhDNuRLLSg`, บัญชี noonoy.cmu@gmail.com)
- Deployment เวอร์ชัน 3 (1.7.0 — Reports + Counter): `AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT` (Execute as: Me, Access: Anyone)
- Script Property: `SMART_AGRI_API_KEY` = คีย์ "Green Gain Hub — Backend proxy" (prefix `kpp_fa4750`) ของระบบ Smart Agri-Materials

> ⚠️ `AKfycbxoo4…` เป็นของระบบ **KPP Smart Agri-Materials v2** ห้ามวางโค้ด GGH หรือ Deploy ทับ

## อัปเดตโค้ดครั้งถัดไป

1. เปิดโปรเจกต์ Green Gain Hub KPP API แล้ววางไฟล์ `apps-script/Code.gs`, `Districts.gs`, `Admin.gs`, `Crops.gs`, `Counter.gs`, `Reports.gs` (ชื่อไฟล์ใน Apps Script ตรงกัน)
2. Run `setupSystem()` (บรรทัดสุดท้ายแสดงผลการเชื่อมต่อ Smart Agri: `PASS`, `INFO` หรือ `FAIL`)
3. **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > ✏️ แก้ไข** Deployment `AKfycbylUGpPc7g9…` > **เวอร์ชันใหม่** > ทำให้ใช้งานได้ (URL เดิม)
4. ตรวจ `…/exec?api=v1&endpoint=health` และ `…/exec?api=v1&endpoint=summary&refresh=1`

## Script Properties

| Property | ค่า | จำเป็น |
| --- | --- | --- |
| `SMART_AGRI_API_KEY` | API Key จากระบบ Smart Agri (Super Admin สร้าง/ยกเลิกได้) | ใช่ สำหรับข้อมูลรายงาน |
| `SMART_AGRI_API_URL` | URL `/exec` ของ Smart Agri ถ้าเปลี่ยน Deployment | ไม่ |
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
