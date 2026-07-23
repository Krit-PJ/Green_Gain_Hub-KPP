# API Contract

Endpoint:

`https://script.google.com/macros/s/AKfycbwQLSoTT71Tsgt2IITpkQKE57qBvYrA9MLSt-Yg6r3-1a2X04mJ0xmqMHEK-tcV2iPe/exec`

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

`getMatchingDataServer()` ส่ง `apiVersion: "1.3.1"` และจำกัดข้อมูลตามบทบาทจาก session:

- ผู้ขาย/เกษตรกรได้รับเฉพาะ `buyers`: ผู้รับซื้อสถานะ `Active` ที่มีพิกัดถูกต้อง ส่วน `farmers` เป็นอาร์เรย์ว่าง
- ผู้รับซื้อได้รับเฉพาะ `farmers`: เกษตรกรสถานะ `Open` ที่มีพิกัดถูกต้อง โดยไม่อ่าน `Map_Visible` และไม่ใช้กฎ 10 วัน ส่วน `buyers` เป็นอาร์เรย์ว่าง
- `viewerRole` ระบุบทบาทผู้ใช้ และ `visibleRole` ระบุบทบาทคู่ค้าที่อนุญาตให้เห็น

Frontend แสดงเฉพาะหมุด รายชื่อ เบอร์โทรศัพท์ และปลายทางนำทางของบทบาทฝั่งตรงข้าม หมุดเกษตรกรเป็นสีเขียวและหมุดผู้รับซื้อเป็นสีน้ำเงิน

`getApiInfoServer()` เป็นคำสั่งสาธารณะสำหรับตรวจว่า Web App Deployment ใช้ Backend เวอร์ชัน 1.3.1 แล้ว โดยไม่ส่งข้อมูลส่วนบุคคลจากชีต

เมื่อผู้รับซื้อเลือก `ALL` Frontend ส่งต่อข้อมูล `farmers` ทั้งชุดโดยไม่กรองปี เดือน หรือวันเก็บเกี่ยวเพิ่มเติม

ปุ่ม `โทรติดต่อ` ใช้ URI `tel:` กับหมายเลขโทรศัพท์ 10 หลัก และปุ่ม `เริ่มนำทาง` ใช้ Google Maps Directions URL พร้อม `destination`, `travelmode=driving` และ `dir_action=navigate`

หลัง `loginServer` สำเร็จ Frontend เก็บ session token ใน `sessionStorage` และแนบ token กับคำขอถัดไป Session มีอายุสูงสุด 6 ชั่วโมง

`doGet(e)` ใช้ allowlist จึงไม่สามารถเรียกฟังก์ชัน Apps Script อื่นจากภายนอกได้
