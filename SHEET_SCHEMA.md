
## Research_Refs (ใช้โดย Dashboard 1.5.0 — ไม่บังคับ)

`ID, Type, SubType, BioRate, PriceMin, PriceMax, PriceAvg, Source`

- `Type`: ชื่อชนิดวัสดุเหลือใช้ทางการเกษตรให้ตรงกับระบบ เช่น `ฟางข้าว`, `ใบอ้อย`, `เหง้ามันสำปะหลัง`
- `BioRate`: ปริมาณวัสดุเหลือใช้ทางการเกษตร **ตันต่อไร่** ถ้าเว้นว่าง Dashboard จะไม่ประมาณปริมาณ (แนะนำระบุ `Source` ทุกค่า)

## Goals (ใช้โดย Dashboard 1.5.0 — ไม่บังคับ)

`ID, Icon, Title, Description, SortOrder, Active` — แสดงเฉพาะแถวที่ `Active` เป็น `TRUE` สูงสุด 8 รายการ

## ชีตใหม่ใน 1.6.0 (สร้างอัตโนมัติโดย `setupSystem()`)

| ชีต | คอลัมน์ | หมายเหตุ |
| --- | --- | --- |
| `admins` | Username, Name, Role, Status, Pass_Hash, Salt, Created_At, Created_By, Last_Login, Updated_At, Telephone | Role = `super`/`admin`, Status = `active`/`disabled` ไม่มีรหัสผ่านแบบข้อความ |
| `admin_log` | Time, Username, Name, Role, Action, Detail | บันทึกทุกการกระทำของผู้ดูแล |
| `crop_types` | Crop, Material, Active, Sort_Order, Updated_At | ชนิดพืชที่เลือกได้ตอนนำเข้า |
| `crop_imports` | Import_ID, Crop, Season, Month_Type, File_Name, Rows, Total_Rai, Periods, Status, Imported_At, Imported_By, Replaced_By, Note | Status = `active`/`replaced`/`deleted` หน้าแรกใช้เฉพาะ `active` |
| `crop_stats` | Import_ID, Crop, Season, Month_Type, Period, Level, Code, Name, Households, Plots, Area_Rai | 1 แถว = 1 พื้นที่ × 1 เดือน, Level = province/district/subdistrict |

| `visit_stats` (1.7.0) | Date, Visits, Updated_At | 1 แถว = 1 วัน (yyyy-MM-dd เวลาไทย) ยอดรวมทั้งหมดอยู่ที่ `Config!visit_count` |

| `admins` (2.0.0) | + District_Code (คอลัมน์ L) | Role = `super` / `mini` / `admin` (Admin ต้องมีอำเภอ) |
| `residue_records` (2.0.0) | Record_ID, Record_Date, Fiscal_Year, District_Code, District_Name, Subdistrict_Code, Subdistrict_Name, Crop_Key, Crop_Name, Crop_Other, Method, Method_Other, Area_Rai, Lat, Lng, Photo_IDs, Biomass_Mode, MB_kg_rai, Cf, Fresh_kg_rai, DMF, Data_Status, Reference, Note, Recorded_By, Recorder_Name, Confirmed_At, Status, Created_At, Updated_At, Updated_By | Status = `active`/`deleted` (ลบแบบเก็บประวัติ) ภาพอยู่ในโฟลเดอร์ Drive `GGH ภาพการจัดการเศษวัสดุ` |
| `residue_methods` (2.0.0) | Method, Crop_Key, Needs_Detail, Active, Sort_Order, Updated_At | Crop_Key ว่าง = ทุกพืช |
| `residue_targets` (2.0.0) | Fiscal_Year, District_Code, District_Name, Method, Target_Rai, Officers, Note, Updated_At, Updated_By | Method ว่าง = เป้ารวมอำเภอ |
| `ghg_params` (2.0.0) | Key, Value, Unit, Description | EF, GWP, ชุดค่า, โหมด, เลขชุดค่า |
| `ghg_crops` (2.0.0) | Crop_Key, Crop_Name, Consumed_t_ha, Cf, Residue_t_rai, Residue_Name, Residue_Reference, IPCC_Reference, Active, Sort_Order, Updated_At, Updated_By | ค่าว่าง = ไม่มีค่ามาตรฐาน |
| `Config` (2.0.0) | + province_name, office_name | |
| `ghg_crops` (2.1.0) | + Price_baht_kg, Price_Reference | ค่าเริ่มต้น 10 บาท/กก. |
| `residue_methods` (2.1.0) | + Count_Value | ไถกลบ = FALSE เป็นค่าเริ่มต้น |
| `admins` (2.1.0) | + Office_Type, Office_Group, Province, Registered_Via | ลงทะเบียนเอง: Username = p+เบอร์, Registered_Via = self, ไม่มีรหัสผ่าน |
| `Config` (2.1.0) | + staff_groups | กลุ่มของสำนักงานเกษตรจังหวัด คั่นด้วย \| |
| `ghg_crops` (2.2.0) | + Use_Global_Price, Removable_Pct, Removable_Reference | ว่าง/TRUE = ใช้ราคากลาง; สัดส่วนที่นำออกได้ ข้าว 45 ข้าวโพด 42 อ้อย 40 |
| `ghg_params` (2.2.0) | + PRICE_BAHT_KG, PRICE_REF, PRICE_VERSION, PRICE_UPDATED_AT, PRICE_UPDATED_BY | ราคากลาง เริ่มต้น 0.8 บาท/กก. |
| `residue_records` (2.2.0) | + Buyer_ID, Buyer_Name, Sold_Tonnes | ไม่บังคับ; Sold_Tonnes ใช้คิดมูลค่าแทนค่าประมาณ |

ห้ามแก้ไขชีตเหล่านี้ด้วยมือระหว่างใช้งาน ให้จัดการผ่านหน้า `admin.html`

## 3.0.0: จังหวัด–อำเภอ–ตำบล (เพิ่มท้ายตาราง ไม่ย้ายคอลัมน์เดิม · เติมอัตโนมัติ)

| ชีต | คอลัมน์ | ความหมาย |
| --- | --- | --- |
| `users` | J `Province_Code`, K `Province` | จังหวัดที่ผู้ใช้เลือกตอนลงทะเบียน (ผู้ใช้เดิม: จังหวัดของหมุดแรก ไม่มีหมุด = 62 กำแพงเพชร) |
| `farmers` | S `Province_Code`, T `Province`, U `District_Code`, V `District`, W `Subdistrict_Code`, X `Subdistrict` | ตำแหน่งของหมุดแปลง คำนวณโดยเซิร์ฟเวอร์ (Geo.gs) ทุกครั้งที่บันทึก |
| `buyers` | R–W (ชื่อเดียวกัน) | ตำแหน่งของหมุดจุดรับซื้อ |

รหัสจังหวัด 2 หลัก อำเภอ 4 หลัก ตำบล 6 หลัก ตามชุดข้อมูลขอบเขต (เช่น 62 / 6201 / 620101)

