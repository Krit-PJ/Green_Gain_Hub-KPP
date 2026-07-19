# API Contract

Endpoint:

`https://script.google.com/macros/s/AKfycbzuf51J4DpqXcvlcYETyNgxi3fkHmEISFM0jrj6Nhn_rrvOKzYsa-Dtf9WXEsnCSHzj/exec`

Transport: JSONP จาก GitHub Pages เพื่อรองรับ cross-origin โดยไม่ฝัง credential ใน Browser

## Public methods

- `loginServer({ username })`
- `registerServer({ role, name, phone })`

## Session-required methods

- `getUserProfileServer()`
- `saveDataServer(payload)`
- `deleteDataServer(payload)`
- `getMatchingDataServer()`

หลัง `loginServer` สำเร็จ Frontend เก็บ session token ใน `sessionStorage` และแนบ token กับคำขอถัดไป Session มีอายุสูงสุด 6 ชั่วโมง

`doGet(e)` ใช้ allowlist จึงไม่สามารถเรียกฟังก์ชัน Apps Script อื่นจากภายนอกได้
