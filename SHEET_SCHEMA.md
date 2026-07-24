# Google Sheet schema — Green Gain Hub 1.4.1

รุ่นนี้ไม่เพิ่ม ลบ หรือเปลี่ยนลำดับคอลัมน์

## farmers

- `E Phone`: รูปแบบข้อความ
- `G Plant_Date`: รูปแบบแสดงผล `yyyy-mm-dd`
- `H Havest_Date`: รูปแบบแสดงผล `yyyy-mm-dd`
- `J:K Lat/Lng`: พิกัดแปลง
- `M Owner_Telephone`: รูปแบบข้อความและเป็นคีย์หลักของเจ้าของแปลง
- `Q Map_Visible`: คงไว้เพื่อความเข้ากันได้

## buyers

- `E Phone`: รูปแบบข้อความ
- `F:G Lat/Lng`: พิกัดสถานที่รับซื้อ
- `M Owner_Telephone`: รูปแบบข้อความ
- `Q Purchase_After_Harvest_Days`: คงไว้เพื่อไม่ทำลาย schema แต่รุ่น 1.4.1 ไม่ใช้กรองหรือแสดงผล

## users

- `A Telephone`: รูปแบบข้อความ

`setupSystem()` กำหนดรูปแบบคอลัมน์ และแปลงเฉพาะข้อมูลเก่าที่ระบุได้แน่นอน ได้แก่ เบอร์ 9 หลักที่เลขศูนย์นำหน้าหาย และวันที่ที่ตรงกับ `yyyy-mm-dd` หรือ `d/m/yyyy` ค่าที่กำกวม/ไม่ถูกต้องจะไม่ถูกแก้
