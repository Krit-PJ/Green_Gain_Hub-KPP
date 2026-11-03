# Deploy Green Gain Hub 1.5.0

สถานะ 3 พ.ย. 2569: **Deploy แล้ว**

- Apps Script: **Green Gain Hub KPP API** (`1JfUtXCoOvrb_Nz2N6xgRBSiT72DSWV92pFepA20eNcGb8WUhDNuRLLSg`, บัญชี noonoy.cmu@gmail.com)
- Deployment เวอร์ชัน 1: `AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT` (Execute as: Me, Access: Anyone)
- Script Property: `SMART_AGRI_API_KEY` = คีย์ "Green Gain Hub — Backend proxy" (prefix `kpp_fa4750`) ของระบบ Smart Agri-Materials

> ⚠️ `AKfycbxoo4…` เป็นของระบบ **KPP Smart Agri-Materials v2** ห้ามวางโค้ด GGH หรือ Deploy ทับ

## อัปเดตโค้ดครั้งถัดไป

1. เปิดโปรเจกต์ Green Gain Hub KPP API แล้ววาง `apps-script/Code.gs` และ `apps-script/Districts.gs`
2. Run `setupSystem()` (บรรทัดสุดท้ายแสดงผลการเชื่อมต่อ Smart Agri: `PASS`, `INFO` หรือ `FAIL`)
3. **ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > ✏️ แก้ไข** Deployment `AKfycbylUGpPc7g9…` > **เวอร์ชันใหม่** > ทำให้ใช้งานได้ (URL เดิม)
4. ตรวจ `…/exec?api=v1&endpoint=health` และ `…/exec?api=v1&endpoint=summary&refresh=1`

## Script Properties

| Property | ค่า | จำเป็น |
| --- | --- | --- |
| `SMART_AGRI_API_KEY` | API Key จากระบบ Smart Agri (Super Admin สร้าง/ยกเลิกได้) | ใช่ สำหรับข้อมูลรายงาน |
| `SMART_AGRI_API_URL` | URL `/exec` ของ Smart Agri ถ้าเปลี่ยน Deployment | ไม่ |
| `SPREADSHEET_ID` | ใช้ Sheet อื่นแทนค่าเริ่มต้น | ไม่ |
| `SUMMARY_API_KEY` | บังคับ key สำหรับ summary ของ GGH | ไม่ |

ถ้าคีย์ Smart Agri ถูกยกเลิกหรือหมดอายุ หน้าแรกยังทำงาน แต่ส่วนรายงานจะแสดง "ยังโหลดข้อมูลรายงานไม่ได้" ให้สร้างคีย์ใหม่แล้วแก้ Script Property

## หลังสลับระบบ

- Archive Deployment เดิม `AKfycbwQLS…` (ยังเขียนลง Sheet เดิม) เพื่อไม่ให้ข้อมูลแยกสองที่
- ตรวจหน้าเว็บแบบ Incognito: หน้าแรกแสดงข้อมูลรายงานและตลาด, เข้าสู่ระบบด้วยเบอร์เดิมได้
