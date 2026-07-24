# Deploy Green Gain Hub 1.4.1

## Apps Script

1. เปิด Google Sheet แล้วเลือก **ส่วนขยาย > Apps Script**
2. แทน Code.gs เดิมด้วย `apps-script/Code.gs`
3. บันทึกและ Run `setupSystem()`
4. ตรวจว่าผลลัพธ์ทุกบรรทัดขึ้นต้นด้วย `PASS`
5. Run `verifyLiveMatchingData()`
6. เลือก **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > แก้ไข**
7. เลือก **เวอร์ชันใหม่** และกด **ทำให้ใช้งานได้**

คง Deployment เดิม:

`AKfycbwQLSoTT71Tsgt2IITpkQKE57qBvYrA9MLSt-Yg6r3-1a2X04mJ0xmqMHEK-tcV2iPe`

## GitHub Pages

1. นำไฟล์ภายในโฟลเดอร์ `frontend` วางที่ราก Repository (`index.html`, `.nojekyll`, `assets/...`)
2. Commit ข้อความ `Deploy Green Gain Hub 1.4.1`
3. Push ไป `main`
4. รอ Workflow ในแท็บ Actions สำเร็จ
5. เปิดเว็บแบบ Incognito หรือ Hard Refresh และเข้าสู่ระบบใหม่

## ตรวจหลังติดตั้ง

- API เป็น `1.4.1`
- หน้าเว็บใช้ `BUILD_VERSION: '1.4.1'` และ `MINIMUM_API_VERSION: '1.3.1'`
- ข้าวนาปี/ข้าวนาปรัง → ฟางข้าว
- อ้อยโรงงาน → ใบอ้อย
- มันสำปะหลัง → เหง้ามันสำปะหลัง
- เกษตรกรหลายแปลงเห็นหมุดแปลงของตนครบทุกแปลง
- เกษตรกรเห็นข้อมูลติดต่อเฉพาะผู้รับซื้อ
- ผู้รับซื้อเห็นข้อมูลติดต่อเฉพาะเกษตรกร
- แบบฟอร์มผู้รับซื้อไม่มีช่องจำนวนวันหลังเก็บเกี่ยว
- บันทึกโทรศัพท์แล้วยังมีเลข `0` ด้านหน้า
- วันที่ใน `farmers!G:H` แสดงเป็น `yyyy-mm-dd`
