# Green Gain Hub API 1.4.1

Frontend เรียก Google Apps Script ผ่าน JSONP ที่ URL `/exec` เดิม

## Matching response

`getMatchingDataServer()` ส่ง:

- `viewerRole`: บทบาทของ session
- `visibleRole`: บทบาทคู่ค้าที่อนุญาตให้เห็น
- `farmers`: มีข้อมูลเฉพาะเมื่อผู้ดูเป็นผู้รับซื้อ
- `buyers`: มีข้อมูลเฉพาะเมื่อผู้ดูเป็นเกษตรกร
- `ownPlots`: มีเฉพาะแปลงที่เป็นเจ้าของ session เกษตรกร และเป็นค่าว่างสำหรับผู้รับซื้อ

`ownPlots` ไม่ใช่คู่ค้าสำหรับโทรหรือนำทาง จึงไม่มีปุ่มติดต่อใน Frontend

## Compatibility

- รองรับเบอร์โทรศัพท์ 9 หลักจากข้อมูลเก่าที่เลข `0` ด้านหน้าหาย
- ส่งวันที่ให้ Frontend เป็น ISO `yyyy-mm-dd`
- อ่านวันที่เดิมแบบ `d/m/yyyy` และปี พ.ศ. ได้
- คอลัมน์ `Purchase_After_Harvest_Days` คงไว้ แต่ไม่เป็นเงื่อนไขของ API อีกต่อไป

`getApiInfoServer()` ต้องรายงาน `apiVersion: "1.4.1"` และ
`feature: "NORMALIZED_SHEET_FORMATS_BUYER_OVERVIEW_OWN_PLOTS"`
