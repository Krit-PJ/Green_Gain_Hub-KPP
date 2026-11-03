
## Research_Refs (ใช้โดย Dashboard 1.5.0 — ไม่บังคับ)

`ID, Type, SubType, BioRate, PriceMin, PriceMax, PriceAvg, Source`

- `Type`: ชื่อชนิดเศษวัสดุให้ตรงกับระบบ เช่น `ฟางข้าว`, `ใบอ้อย`, `เหง้ามันสำปะหลัง`
- `BioRate`: ปริมาณเศษวัสดุ **ตันต่อไร่** ถ้าเว้นว่าง Dashboard จะไม่ประมาณปริมาณ (แนะนำระบุ `Source` ทุกค่า)

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

ห้ามแก้ไขชีตเหล่านี้ด้วยมือระหว่างใช้งาน ให้จัดการผ่านหน้า `admin.html`
