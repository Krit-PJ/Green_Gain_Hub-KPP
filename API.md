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
