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

`getMatchingDataServer()` ส่ง `apiVersion: "1.2.1"` และเกษตรกรทุกระเบียนที่มีสถานะ `Open` และมีพิกัดถูกต้อง โดยไม่อ่าน `Map_Visible` และไม่กรองวันเก็บเกี่ยวหรือกฎ 10 วัน พร้อมส่ง `farmers[].harvestDate` ในรูป `YYYY-MM-DD` ให้ Frontend ใช้สร้างตัวเลือกปี พ.ศ. และกรองช่วงเดือนเฉพาะเมื่อผู้ใช้เลือกปี

`getApiInfoServer()` เป็นคำสั่งสาธารณะสำหรับตรวจว่า Web App Deployment ใช้ Backend เวอร์ชัน 1.2.1 แล้ว โดยไม่ส่งข้อมูลส่วนบุคคลจากชีต

เมื่อผู้รับซื้อเลือก `ALL` Frontend ส่งต่อข้อมูล `farmers` ทั้งชุดโดยไม่กรองปี เดือน หรือวันเก็บเกี่ยวเพิ่มเติม

หลัง `loginServer` สำเร็จ Frontend เก็บ session token ใน `sessionStorage` และแนบ token กับคำขอถัดไป Session มีอายุสูงสุด 6 ชั่วโมง

`doGet(e)` ใช้ allowlist จึงไม่สามารถเรียกฟังก์ชัน Apps Script อื่นจากภายนอกได้
