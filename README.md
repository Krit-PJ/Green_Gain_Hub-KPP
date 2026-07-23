# Green Gain Hub 1.2.1 — แก้ข้อมูล Google Sheet ไม่แสดง

รุ่นนี้ปรับความหมายของ “ทั้งหมด” ในเมนู “แผนที่ & คู่ค้า” สำหรับผู้รับซื้อ ให้แสดงข้อมูลเกษตรกรผู้ขายทุกระเบียนที่มีสถานะ `Open` และมีพิกัดละติจูด–ลองจิจูด โดยไม่ใช้วันเก็บเกี่ยว ปี เดือน หรือกฎ 10 วันมาซ่อนข้อมูล

เมื่อเลือกปี พ.ศ. ระบบยังกรองตามปีและช่วงเดือนที่คาดว่าจะเก็บเกี่ยวเหมือนเดิม หมุดทุกแผนที่ยังเป็นสีเขียวสำหรับเกษตรกรและสีน้ำเงินสำหรับผู้รับซื้อ

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
| เปิดแผนที่คู่ค้า | `getMatchingDataServer` | ดาวน์โหลดเกษตรกรสถานะ Open ที่มีพิกัดทั้งหมด และส่งวันเก็บเกี่ยวให้ Frontend ใช้เฉพาะเมื่อกรองปี/ช่วงเดือน |

การเขียน Google Sheet จาก Browser โดยตรงต้องเปิดเผย OAuth credential หรือบังคับผู้ใช้ล็อกอิน Google จึงไม่ควรฝัง credential ใน GitHub repository รุ่นนี้ใช้ API bridge เพื่อให้ `index.html` อยู่บน GitHub ได้จริงโดยไม่เปิดเผยสิทธิ์แก้ไข Sheet

## 1. สร้าง API สำหรับ Google Sheet

1. เปิด [Google Sheet](https://docs.google.com/spreadsheets/d/1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA/edit)
2. เลือก **Extensions > Apps Script**
3. แทนเนื้อหา `Code.gs` ด้วยไฟล์ `apps-script/Code.gs`
4. เปิด manifest แล้ววาง `apps-script/appsscript.json`
5. Run `setupSystem()` หนึ่งครั้ง เพื่อ:
   - เพิ่มหัวคอลัมน์ `Purchase_After_Harvest_Days` ที่ `buyers!Q1` โดยอัตโนมัติ (ไม่เลื่อนคอลัมน์เดิม)
   - ตรวจแท็บและหัวคอลัมน์
   - คืนสถานะ `Expired` ที่เกิดจากกฎเดิมเป็น `Open`
   - ล้างวันหมดอายุเดิมในคอลัมน์ P สำหรับรายการ Open
   - ยกเลิก Trigger เดิมที่เคยเปลี่ยนสถานะตามกฎ 10 วัน
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
  BUILD_VERSION: '1.2.1'
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
- ผู้รับซื้อเลือกดูแปลงเกษตรกรแบบทั้งหมด หรือเลือกปี พ.ศ. และช่วงเดือน
- “ทั้งหมด” แสดงเกษตรกรสถานะ Open ที่มีพิกัดทุกระเบียน โดยไม่กรองวันเก็บเกี่ยว ปี หรือเดือน
- ปีปัจจุบันแสดงเป็นรายการแรกเสมอ และปีอื่นสร้างจากข้อมูลวันเก็บเกี่ยวจริง โดยเรียงจากมากไปน้อย
- การกรองทำบนหน้าแผนที่ ไม่เพิ่มคอลัมน์ใหม่ใน `buyers` หรือ `farmers`
- หมุดเกษตรกรเป็นสีเขียว และหมุดผู้รับซื้อเป็นสีน้ำเงิน ทั้งแผนที่หลักและแผนที่บันทึกพิกัด
- ฟางข้าว, ใบอ้อย, เหง้ามันสำปะหลัง, อื่นๆ พร้อมกรอกเอง
- Card บันทึกข้อมูลซ้าย และแผนที่คู่ค้าขวา
- ไม่มีการซ่อน Farmer ตามจำนวนวันหลังวันเก็บเกี่ยว
- Session token, API allowlist, owner check และ soft delete

## 5. ตรวจสอบก่อนใช้งาน

- `setupSystem()` แสดง PASS ครบ
- Run `verifyLiveMatchingData()` และตรวจว่าจำนวนที่รายงานตรงกับแถว `Open` ที่มีพิกัด
- หาก Frontend แจ้ง “Backend ยังไม่ใช่เวอร์ชัน 1.2.1” ต้อง Deploy Apps Script แบบ New version ก่อน
- ตรวจว่า `SHEETS_API_URL` ใน `config.js` ตรงกับ Deployment URL ด้านบน
- ทดสอบลงทะเบียนด้วยหมายเลขใหม่หนึ่งรายการ
- ทดสอบ Upload ข้อมูล Farmer และ Buyer
- ทดสอบ Download ข้อมูลหลัง Refresh หน้า GitHub Pages
- เข้าสู่ระบบเป็นผู้รับซื้อ แล้วทดสอบตัวกรอง “ทั้งหมด” และปี พ.ศ.
- เมื่อเลือก “ทั้งหมด” ตรวจว่ารายการ Open ที่มีพิกัดยังแสดง แม้วันเก็บเกี่ยวจะผ่านมามากกว่า 10 วัน
- เลือกเดือนเริ่มต้น–เดือนสิ้นสุด แล้วตรวจว่าจำนวนแปลง รายการ และหมุดสีเขียวเปลี่ยนพร้อมกัน
- เข้าสู่ระบบเป็นเกษตรกร แล้วตรวจว่าหมุดผู้รับซื้อเป็นสีน้ำเงิน
- ทดสอบบน Smartphone และ Computer
- ตรวจว่า Google Sheet ไม่ได้แชร์สิทธิ์แก้ไขแบบสาธารณะ
