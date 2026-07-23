# Green Gain Hub 1.3.1 — ไฟล์สำหรับ GitHub Pages

ให้นำไฟล์และโฟลเดอร์ภายในชุดนี้ไปวางที่ **รากของ Repository**
`Krit-PJ/Green_Gain_Hub-KPP` บนสาขา `main`

โครงสร้างที่ถูกต้อง:

```text
Green_Gain_Hub-KPP/
├── index.html
├── .nojekyll
└── assets/
    ├── config.js
    └── api-client.js
```

ห้ามอัปโหลดโฟลเดอร์ `GGH_1.3.1_GitHub_Pages_ROOT_READY` เป็นโฟลเดอร์ซ้อน
เพราะ GitHub Pages จะยังอ่าน `index.html` และ `assets/config.js` ชุดเก่าที่ราก Repository

## ค่าที่ต้องตรวจหลังอัปโหลด

- `assets/config.js` ต้องมี `BUILD_VERSION: '1.3.1'`
- `SHEETS_API_URL` ต้องขึ้นต้นด้วยรหัส Deployment `AKfycbwQL`
- Apps Script API ต้องรายงาน `apiVersion: "1.3.1"`

## หลัง Commit

1. เปิดแท็บ **Actions** และรอ Workflow สำเร็จ
2. เปิด `https://krit-pj.github.io/Green_Gain_Hub-KPP/`
3. ออกจากระบบ แล้วเข้าสู่ระบบใหม่
4. เปิดแบบไม่ระบุตัวตน หรือกด Hard Refresh
5. ผู้ขายต้องเห็นเฉพาะผู้รับซื้อ และผู้รับซื้อต้องเห็นเฉพาะผู้ขาย

ชุดนี้เพิ่ม cache-busting ให้ `config.js` และ `api-client.js` เพื่อป้องกัน Smartphone
เรียกไฟล์รุ่นเก่าจากแคช
