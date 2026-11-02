# Deploy Green Gain Hub 1.5.0

Frontend ชี้ไปที่ Deployment `AKfycbxoo4VuAomjDPaDPXgEF6y0CFVxBfor-4OmIi3bQVik7FCgAx_7XghYmeav7BHDbpLcaw` แล้ว ต้องอัปเดตโค้ดใน Apps Script โปรเจกต์ที่เป็นเจ้าของ Deployment นี้ ก่อน merge ขึ้น GitHub Pages

## 1. Apps Script (ประมาณ 5 นาที)

1. เปิด https://script.google.com ด้วยบัญชีที่สร้าง Deployment `AKfycbxoo4…`
   (ตรวจได้ที่ **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้** — Deployment ID ต้องตรง)
2. แทนที่ `Code.gs` ด้วย `apps-script/Code.gs`
3. กด **+ > สคริปต์** สร้างไฟล์ชื่อ `Districts` แล้ววางเนื้อหา `apps-script/Districts.gs`
4. ตรวจ `appsscript.json` ให้ตรงกับ `apps-script/appsscript.json` (Web App: Anyone, Execute as: Me)
5. **บัญชีที่ Deploy ต้องมีสิทธิ์แก้ไข** Sheet `Green Gain Hub KPP — Database (v1.5.0)`
   (`1TU2kC7kzJbb9JZzo4m7D3eOmcW8Ra_osic33rolE-Hw`, เจ้าของ noonoy.cmu@gmail.com) — ถ้าคนละบัญชี ให้แชร์สิทธิ์ Editor ก่อน
6. โค้ดชี้ไปที่ Sheet ใหม่โดยค่าเริ่มต้น ถ้าเคยตั้ง Script Property `SPREADSHEET_ID` ไว้ ให้แก้เป็น ID ข้างบนหรือลบออก
7. เลือกฟังก์ชัน `setupSystem` > **Run** > อนุญาตสิทธิ์ ทุกบรรทัดต้องขึ้นต้นด้วย `PASS` และบรรทัดสุดท้ายแสดงจำนวนแปลง/อำเภอ
8. **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > ✏️ แก้ไข** Deployment `AKfycbxoo4…` > เวอร์ชัน **เวอร์ชันใหม่** > **ทำให้ใช้งานได้**
   (แก้ไข Deployment เดิม URL จะไม่เปลี่ยน — อย่ากด "การทำให้ใช้งานได้รายการใหม่")

ตรวจในเบราว์เซอร์:

- `…/exec?api=v1&endpoint=health` → `"apiVersion":"1.5.0"`
- `…/exec?api=v1&endpoint=summary&key=YOUR_KEY` → `"ok":true` และ `totals.farmerPlots` ตรงกับจำนวนแปลง Open

ไม่บังคับ: ตั้ง Script Property `SUMMARY_API_KEY` แล้วใส่ค่าเดียวกันใน `SUMMARY_API_KEY` ของ `frontend/assets/config.js`

## 2. GitHub Pages

1. Merge Pull Request `feature/public-dashboard-1.5.0` เข้า `main`
2. รอ Workflow ในแท็บ Actions สำเร็จ (deploy จากโฟลเดอร์ `frontend/`)
3. เปิดเว็บแบบ Incognito หรือ Hard Refresh

## ข้อควรระวังเรื่องข้อมูล

- Sheet ใหม่คัดลอกจาก Sheet เดิมเมื่อ 3 พ.ย. 2569 เวลา 00:30 น. ถ้ามีผู้ลงทะเบียน/บันทึกในระบบเดิมหลังเวลานั้นก่อนสลับ Deployment ให้คัดลอกแถวใหม่จาก Sheet เดิมมาเพิ่ม
- Deployment เดิม `AKfycbwQLS…` ยังเขียนลง Sheet เดิมอยู่ เมื่อสลับเสร็จควร **เก็บถาวร (Archive)** Deployment เดิม เพื่อไม่ให้ข้อมูลแยกสองที่

## ตรวจหลังติดตั้ง

- หน้าแรกแสดงตัวเลขสรุป แผนที่ 11 อำเภอ ปฏิทินเก็บเกี่ยว และตารางรายอำเภอ
- เลือกอำเภอบนแผนที่/ตาราง/ช่องค้นหาแล้วรายละเอียดด้านขวาเปลี่ยนตาม
- เข้าสู่ระบบด้วยเบอร์โทรเดิมได้ และหน้าหลังเข้าสู่ระบบทำงานเหมือน 1.4.1 ทุกอย่าง
- ถ้า API ล่ม หน้าแรกยังเข้าสู่ระบบได้ และแสดงข้อความพร้อมปุ่ม "ลองใหม่"
