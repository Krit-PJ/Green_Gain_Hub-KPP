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

---

# Public API v1 (Green Gain Hub 1.5.0)

URL เดียวกับ Web App (`/exec`) รองรับทั้ง `fetch` (JSON) และ JSONP (`&callback=`)

| Endpoint | ตัวอย่าง |
| --- | --- |
| สรุป Dashboard | `/exec?api=v1&endpoint=summary&key=YOUR_KEY` |
| ตรวจเวอร์ชัน | `/exec?api=v1&endpoint=health` |

`key` ไม่บังคับ ยกเว้นตั้ง Script Property `SUMMARY_API_KEY` ไว้ (คีย์ในหน้าเว็บสาธารณะมองเห็นได้ จึงใช้กันการนำไปใช้ซ้ำแบบง่ายเท่านั้น) เพิ่ม `&refresh=1` เพื่อข้าม cache

```json
{
  "ok": true, "api": "v1", "endpoint": "summary", "apiVersion": "1.5.0",
  "data": {
    "generatedAt": "...", "province": "กำแพงเพชร", "cacheSeconds": 300,
    "totals": { "farmerPlots": 16, "farmers": 7, "plotsWithCoordinates": 16, "areaRai": 284.31,
      "buyers": 9, "capacityTonPerDay": 250, "avgBuyerPriceBahtPerRai": 30,
      "potentialValueBaht": 7614, "residueTon": null, "districtsCovered": 3, "districtsTotal": 11 },
    "upcomingHarvest": { "days30": { "plots": 0, "areaRai": 0 }, "days60": { "plots": 0, "areaRai": 0 } },
    "byDistrict": [{ "code": "6204", "name": "ขาณุวรลักษบุรี", "plots": 9, "farmers": 3, "areaRai": 184.75,
      "buyers": 9, "capacityTonPerDay": 250, "residueTon": null, "materials": [{ "material": "ฟางข้าว", "areaRai": 154.25 }, { "material": "เหง้ามันสำปะหลัง", "areaRai": 30.5 }] }],
    "byMaterial": [{ "material": "ฟางข้าว", "plots": 15, "areaRai": 253.81, "buyers": 9, "capacityTonPerDay": 250,
      "avgBuyerPriceBahtPerRai": 30, "potentialValueBaht": 7614, "bioRateTonPerRai": null, "residueTon": null }],
    "byCrop": [{ "crop": "ข้าวนาปรัง", "material": "ฟางข้าว", "plots": 6, "areaRai": 129.81 }],
    "harvestByMonth": [{ "month": "2026-11", "plots": 0, "areaRai": 0, "isCurrent": true }],
    "goals": [], "notes": { "area": "...", "price": "...", "residue": "...", "privacy": "..." }
  }
}
```

กติกา: นับเฉพาะแปลง `Open` และผู้รับซื้อ `Active`; พื้นที่แปลงจาก `ไร่-งาน-ตร.ว.`; อำเภอคำนวณจากพิกัดด้วย `Districts.gs` (ไม่มีพิกัด/อยู่นอกจังหวัด → `OTHER`); `potentialValueBaht` = พื้นที่ × ราคาเฉลี่ยของผู้รับซื้อวัสดุชนิดเดียวกัน

## `data.reports` — KPP Smart Agri-Materials (เพิ่มใน summary)

Backend เรียก `…AKfycbxoo4…/exec?api=v1&endpoint=summary|districts|timeseries|meta&items=agri&key=…` ฝั่ง Server แล้วจัดรูปใหม่ (cache 5 นาที, ล้มเหลว cache 1 นาที)

```json
"reports": {
  "ok": true, "configured": true,
  "source": { "name": "KPP Smart Agri-Materials", "office": "...", "title": "...", "season": "2569 - 2570" },
  "round": { "round": 2, "label": "ครั้งที่ 2", "start": "2026-10-29", "end": "2026-11-04", "due": "2026-11-06" },
  "districtsTotal": 11, "reportedCount": 0, "statusCounts": { "accepted": 0, "submitted": 0, "draft": 0, "returned": 0, "none": 11 },
  "items": [{ "id": "R31", "label": "ไถกลบตอซัง/การใช้สารย่อยสลาย", "unit": "ไร่", "week": null, "cumulative": null, "districtsYes": 0 }],
  "byDistrict": [{ "code": "6201", "sourceCode": "D01", "name": "เมืองกำแพงเพชร", "status": "none", "items": { "R31": { "week": null, "cumulative": null } } }],
  "series": [{ "round": 1, "label": "ครั้งที่ 1", "start": "2026-10-22", "end": "2026-10-28", "reported": 0, "values": { "R31": { "week": null, "cumulative": null } } }]
}
```

- `code` = รหัสอำเภอ (amp_code) ตรงกับขอบเขตใน `Districts.gs`
- `null` = ยังไม่มีรายงาน (ไม่ใช่ 0)
- ถ้าเรียกไม่สำเร็จ: `{ "ok": false, "configured": true|false, "error": "..." }` ส่วนอื่นของ summary ยังทำงาน
- คีย์ไม่ถูกส่งไปที่ browser (มีเทสต์ตรวจ)

## 1.6.0: `data.crops` (ข้อมูลเพาะปลูก)

```json
"crops": { "ok": true, "source": "ระบบฐานข้อมูลทะเบียนเกษตรกรกลาง กรมส่งเสริมการเกษตร", "crops": [{
  "crop": "ข้าวนาปี", "season": "2569/70", "material": "ฟางข้าว", "monthType": "harvest",
  "asOfMonth": 202610, "currentMonth": 202611,
  "totalRai": 1177773.92, "harvestedRai": 912774.35, "remainingRai": 264999.57, "currentMonthRai": 199680.82, "nextMonthRai": 58147.83,
  "months": [{ "month": 202607, "areaRai": 7333.8, "households": 364, "plots": 590 }],
  "byDistrict": [{ "code": "6201", "name": "เมืองกำแพงเพชร", "totalRai": 173887, "harvestedRai": 140613, "remainingRai": 33273, "months": { "202607": 1765.5 } }],
  "residue": null } ] }
```

- `asOfMonth` = เดือนที่ผ่านมา (คงเหลือ = total − ผลรวมเดือน ≤ asOfMonth) หน้าเว็บเลือกเดือนอื่นได้ โดยคำนวณจาก `months`
- `residue` มีค่าเมื่อกำหนด BioRate (ตัน/ไร่) ของชนิดเศษวัสดุใน `Research_Refs`

### รายตำบล

`/exec?api=v1&endpoint=crop&crop=ข้าวนาปี&season=2569/70&district=6201` → `{ subdistricts: [{ code, name, totalRai, harvestedRai, remainingRai, months }] }`

## Admin API (POST)

`POST /exec` body (text/plain): `{"method":"…","args":[…],"token":"…"}` → `{ok, result|error}`
- `adminLoginServer({username,password})` คืน `token` (2 ชั่วโมง)
- Admin: `cropTypesListServer`, `cropTypeSaveServer`, `cropImportCheckServer`, `cropImportCommitServer`, `cropImportsListServer`, `cropImportDeleteServer`, `cacheClearServer`, `adminMeServer`, `adminChangePasswordServer`, `adminLogoutServer`
- Super Admin: `settingsGetServer`, `settingsSaveServer`, `smartAgriTestServer`, `adminsListServer`, `adminSaveServer`, `adminResetPasswordServer`, `adminLogServer`
- RPC ของเกษตรกร/ผู้รับซื้อเรียกผ่าน POST ไม่ได้

## 1.7.0: ตัวนับผู้เข้าชม และรายงาน

- `GET /exec?api=v1&endpoint=hit` นับ 1 ครั้ง (หน้าเว็บเรียกครั้งแรกของ session) → `{ today, month, total, date }`
- `GET /exec?api=v1&endpoint=visits` อ่านอย่างเดียว (cache 60 วินาที) → รูปแบบเดียวกัน
- Admin: `reportCatalogServer()` → หมวด/ส่วนรายงานที่สิทธิ์นี้เลือกได้ และรายการพืช
- Admin: `reportDataServer({sections:[…], crop, season, asOf, title, unmaskPhones})` → `{ title, generatedAt, generatedBy, phonesMasked, sections:[{ key, title, columns, rows, totals, notes }] }` (สูงสุด 20 ส่วน; ส่วน `market.plots`, `market.buyers`, `audit.log` เฉพาะ Super Admin; `unmaskPhones` มีผลเฉพาะ Super Admin)
- Admin: `reportExportLogServer({format:'print'|'xlsx'|'csv', sections})` บันทึกการส่งออก
