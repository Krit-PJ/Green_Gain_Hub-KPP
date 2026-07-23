# Green Gain Hub 1.0.0 — GitHub Pages ↔ Google Sheets

รุ่นนี้เพิ่มตัวกรองสำหรับผู้รับซื้อบนหน้าแผนที่ ให้เลือกข้อมูลแปลงที่คาดว่าจะเก็บเกี่ยวได้แบบ “ทั้งหมด”, “รายปี” หรือ “รายเดือน” โดยใช้วันเก็บเกี่ยวที่เกษตรกรบันทึกไว้แล้ว จึงไม่เพิ่มหรือเลื่อนคอลัมน์ Google Sheet และคงโครงสร้างอื่นจากรุ่น 0.9.0 ไว้ทั้งหมด

เงื่อนไขเดิมยังทำงานครบ: ผู้ซื้อเลือก “ทั้งหมด” หรือ 1–15 วันหลังเก็บเกี่ยวได้ ข้อมูลเดิมที่เป็น 0 หรือยังไม่มีค่าจะใช้ “ทั้งหมด” และค่าเดิม 1–10 วันยังคงใช้ได้

รุ่นนี้วาง `index.html` และไฟล์ Frontend ทั้งหมดบน GitHub Pages ส่วน Google Apps Script ทำหน้าที่เป็น API สำหรับ Upload/Download ข้อมูลกับ Google Sheet เท่านั้น ไม่ได้ใช้ Apps Script เป็นหน้าเว็บไซต์

```text
ผู้ใช้เปิด GitHub Pages
        ↓
frontend/index.html
        ↓  Upload / Download JSON
Google Apps Script API (/exec)
        ↓
Google Sheet: 1.Green Gain HUB_KPP
```

ฐานข้อมูล: [1.Green Gain HUB_KPP](https://docs.google.com/spreadsheets/d/1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA/edit)

## การ Upload และ Download

| การทำงานหน้า GitHub | API | Google Sheet |
|---|---|---|
| ลงทะเบียน | `registerServer` | เพิ่มข้อมูลใน `users` |
| เข้าสู่ระบบ | `loginServer` | อ่าน `users` และออก session token |
| เปิดข้อมูลของฉัน | `getUserProfileServer` | ดาวน์โหลดรายการจาก `farmers`/`buyers` |
| บันทึก/แก้ไข | `saveDataServer` | Upload ข้อมูลไป `farmers`/`buyers` |
| ลบ | `deleteDataServer` | เปลี่ยนสถานะเป็น Deleted |
| เปิดแผนที่คู่ค้า | `getMatchingDataServer` | ดาวน์โหลดข้อมูล Active/Open ที่ผ่านกฎ 10 วัน พร้อมวันเก็บเกี่ยวสำหรับกรองแบบรายปี/รายเดือน |

การเขียน Google Sheet จาก Browser โดยตรงต้องเปิดเผย OAuth credential หรือบังคับผู้ใช้ล็อกอิน Google จึงไม่ควรฝัง credential ใน GitHub repository รุ่นนี้ใช้ API bridge เพื่อให้ `index.html` อยู่บน GitHub ได้จริงโดยไม่เปิดเผยสิทธิ์แก้ไข Sheet

## 1. สร้าง API สำหรับ Google Sheet

1. เปิด [Google Sheet](https://docs.google.com/spreadsheets/d/1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA/edit)
2. เลือก **Extensions > Apps Script**
3. แทนเนื้อหา `Code.gs` ด้วยไฟล์ `apps-script/Code.gs`
4. เปิด manifest แล้ววาง `apps-script/appsscript.json`
5. Run `setupSystem()` หนึ่งครั้ง เพื่อ:
   - เพิ่มหัวคอลัมน์ `Purchase_After_Harvest_Days` ที่ `buyers!Q1` โดยอัตโนมัติ (ไม่เลื่อนคอลัมน์เดิม)
   - ตรวจแท็บและหัวคอลัมน์
   - ทดสอบกฎวันเก็บเกี่ยว +10/+11
   - สร้าง Daily Trigger
6. เลือก **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. คัดลอก URL ที่ลงท้าย `/exec`

Apps Script ชุดนี้เป็น API อย่างเดียว การเปิด `/exec` โดยไม่ส่งคำสั่งจะไม่แสดงเว็บไซต์

## 2. ตั้งค่า Frontend บน GitHub

`frontend/assets/config.js` ถูกตั้งค่า Deployment URL ที่ให้มาแล้ว:

```js
window.GGH_CONFIG = {
  SHEETS_API_URL: 'https://script.google.com/macros/s/AKfycbxdispDx1h_HQ_6N4-GeKP3l6f8tuo4LdPvao5e8qUuUPIOxae1k-dWn9fVj44FlRnJ/exec',
  SPREADSHEET_ID: '1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA',
  REQUEST_TIMEOUT_MS: 30000,
  BUILD_VERSION: '1.0.0'
};
```

ห้ามใส่ Google password, OAuth secret, Service Account key หรือ API credential อื่นใน `config.js`

## 3. เปิด GitHub Pages

1. สร้าง GitHub repository และนำโฟลเดอร์ชุดนี้ขึ้น branch `main`
2. ไปที่ **Settings > Pages**
3. เลือก Source เป็น **GitHub Actions**
4. Workflow `.github/workflows/deploy-pages.yml` จะเผยแพร่เฉพาะ `frontend`

URL หน้าเว็บจะคงเดิมในรูป `https://USERNAME.github.io/REPOSITORY/`

หลังวาง `Code.gs` ให้เลือก **Deploy > Manage deployments > Edit > New version** กับ Deployment เดิม เพื่อให้ API URL ต่อไปนี้คงเดิม:

`https://script.google.com/macros/s/AKfycbxdispDx1h_HQ_6N4-GeKP3l6f8tuo4LdPvao5e8qUuUPIOxae1k-dWn9fVj44FlRnJ/exec`

## 4. โครงสร้างที่คงไว้

- Mobile-first สำหรับ Smartphone และ Computer
- Farmer/Buyer registration และ login ด้วยโทรศัพท์
- หลายแปลง/หลายรายการรับซื้อ
- ผู้ซื้อเลือกวันรับซื้อหลังเก็บเกี่ยวได้ “ทั้งหมด” หรือ 1–15 วัน
- ผู้รับซื้อเลือกดูแปลงที่คาดว่าจะเก็บเกี่ยวแบบทั้งหมด รายปี หรือรายเดือน
- ปีแสดงผลเป็น พ.ศ. และรายการปีสร้างจากข้อมูลวันเก็บเกี่ยวจริง
- การกรองทำบนหน้าแผนที่ ไม่เพิ่มคอลัมน์ใหม่ใน `buyers` หรือ `farmers`
- ฟางข้าว, ใบอ้อย, เหง้ามันสำปะหลัง, อื่นๆ พร้อมกรอกเอง
- Card บันทึกข้อมูลซ้าย และแผนที่คู่ค้าขวา
- ซ่อน Farmer จาก Map ตั้งแต่วันที่ 11 หลังวันเก็บเกี่ยว
- Session token, API allowlist, owner check และ soft delete

## 5. ตรวจสอบก่อนใช้งาน

- `setupSystem()` แสดง PASS ครบ
- ตรวจว่า `SHEETS_API_URL` ใน `config.js` ตรงกับ Deployment URL ด้านบน
- ทดสอบลงทะเบียนด้วยหมายเลขใหม่หนึ่งรายการ
- ทดสอบ Upload ข้อมูล Farmer และ Buyer
- ทดสอบ Download ข้อมูลหลัง Refresh หน้า GitHub Pages
- เข้าสู่ระบบเป็นผู้รับซื้อ แล้วทดสอบตัวกรอง “ทั้งหมด”, “รายปี” และ “รายเดือน”
- ตรวจว่าจำนวนแปลงและรายการบนแผนที่เปลี่ยนตามปี/เดือนที่เลือก
- ทดสอบบน Smartphone และ Computer
- ตรวจว่า Google Sheet ไม่ได้แชร์สิทธิ์แก้ไขแบบสาธารณะ
