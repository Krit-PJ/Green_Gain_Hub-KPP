# API Contract

Endpoint:

`https://script.google.com/macros/s/AKfycbxdispDx1h_HQ_6N4-GeKP3l6f8tuo4LdPvao5e8qUuUPIOxae1k-dWn9fVj44FlRnJ/exec`

Transport: JSONP จาก GitHub Pages เพื่อรองรับ cross-origin โดยไม่ฝัง credential ใน Browser

## Public methods

- `loginServer({ username })`
- `registerServer({ role, name, phone })`

## Session-required methods

- `getUserProfileServer()`
- `saveDataServer(payload)`
- `deleteDataServer(payload)`
- `getMatchingDataServer()`

ข้อมูลผู้ซื้อที่บันทึกและส่งกลับมีฟิลด์ `purchaseAfterHarvestDays` เป็น `ALL` (ทั้งหมด) หรือจำนวนเต็ม 1–15 ข้อมูลเดิมที่เป็น 0 หรือยังไม่มีค่าจะอ่านเป็น `ALL`

`getMatchingDataServer()` ส่ง `farmers[].harvestDate` ในรูป `YYYY-MM-DD` ให้ Frontend ใช้สร้างตัวเลือกปีและกรองข้อมูลแบบรายปี/รายเดือน การกรองนี้ไม่เปลี่ยน API payload และไม่เพิ่มคอลัมน์ฐานข้อมูล

หลัง `loginServer` สำเร็จ Frontend เก็บ session token ใน `sessionStorage` และแนบ token กับคำขอถัดไป Session มีอายุสูงสุด 6 ชั่วโมง

`doGet(e)` ใช้ allowlist จึงไม่สามารถเรียกฟังก์ชัน Apps Script อื่นจากภายนอกได้
