# Google Sheet ที่ระบบ 1.2.2 ใช้งาน

[1.Green Gain HUB_KPP](https://docs.google.com/spreadsheets/d/1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA/edit)

ระบบใช้ข้อมูลจริงในแท็บ `users`, `farmers`, `buyers` โดยไม่อ่านแท็บทดสอบ

ตัวกรอง “ช่วงเวลาเก็บเกี่ยวผลผลิต” ของผู้รับซื้อ ใช้ค่า `farmers!H` (`Havest_Date`) เฉพาะเมื่อเลือกปี พ.ศ. และช่วงเดือน หากเลือก “ทั้งหมด” จะไม่กรองวันเก็บเกี่ยว ปี หรือเดือน รุ่น 1.2.2 ไม่เพิ่มหรือลำดับคอลัมน์ใหม่

## users — A:I

`Telephone, Password, Status, Name, System, Consent, Consent_Timestamp, Created_At, Updated_At`

- คอลัมน์ Password เป็นโครงสร้างเดิมและ API รุ่น 0.7 ไม่อ่านหรือเขียนรหัสผ่าน
- เข้าสู่ระบบด้วย Telephone ตามพฤติกรรมระบบเดิม
- รายการลงทะเบียนใหม่เก็บ Consent และวันเวลาโดยอัตโนมัติ

## farmers — A:R

| ช่วง | ข้อมูล |
|---|---|
| A:L | โครงสร้างเดิม: ID, Timestamp, Name, Surname, Phone, Crop, Plant_Date, Havest_Date, Area, Lat, Lng, Stasus |
| M | Owner_Telephone — เจ้าของรายการ |
| N | Material_Type — ฟางข้าว / ใบอ้อย / เหง้ามันสำปะหลัง / อื่นๆ |
| O | Material_Other — รายละเอียดเมื่อเลือกอื่นๆ |
| P | Map_Expire_Date — คอลัมน์เดิมเพื่อความเข้ากันได้ (รุ่น 1.2.2 ไม่ใช้และล้างค่าในรายการ Open) |
| Q | Map_Visible — คอลัมน์เดิมเพื่อความเข้ากันได้ แสดงค่า TRUE เมื่อสถานะเป็น Open |
| R | Updated_At |

## buyers — A:Q

| ช่วง | ข้อมูล |
|---|---|
| A:L | โครงสร้างเดิม: ID, Timestamp, Name, Surname, Phone, Lat, Lng, Material, Quality, Price, Capacity, Status |
| M | Owner_Telephone — เจ้าของรายการ |
| N | Material_Type |
| O | Material_Other |
| P | Updated_At |
| Q | Purchase_After_Harvest_Days — ผู้ซื้อเลือก `ALL` (ทั้งหมด) หรือ 1–15 วัน (ข้อมูลเดิมที่ว่าง/0 ใช้ `ALL`) |

Backend ตรวจสิทธิ์ด้วย Owner_Telephone และใช้ Phone เป็น fallback เฉพาะข้อมูลเก่าที่ยังไม่มี Owner_Telephone

ไม่ต้องเพิ่ม ลบ หรือย้ายคอลัมน์ใน Google Sheet แต่ต้อง Run `setupSystem()` หนึ่งครั้งหลังวางโค้ดใหม่ เพื่อคืนรายการ `Expired` จากกฎเดิมเป็น `Open` และยกเลิก Trigger หมดอายุเดิม
