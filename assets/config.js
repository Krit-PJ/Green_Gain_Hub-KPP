window.GGH_CONFIG = {
  // Apps Script Web App (/exec) ของ Green Gain Hub KPP API (ไม่ใช่ Smart Agri-Materials)
  // ใช้ทั้งระบบสมาชิก (?action=rpc) และแผนที่ตลาดสาธารณะ (?api=v1&endpoint=market)
  SHEETS_API_URL: 'https://script.google.com/macros/s/AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT/exec',
  // API สาธารณะ (ว่าง = ใช้ SHEETS_API_URL)
  SUMMARY_API_URL: '',
  // ต้องตรงกับ Script Property SUMMARY_API_KEY ถ้าตั้งไว้ (คีย์นี้มองเห็นได้จากหน้าเว็บ ไม่ใช่รหัสลับ)
  SUMMARY_API_KEY: '',
  // ใช้เพื่อแสดงอ้างอิงเท่านั้น สิทธิ์อ่าน/เขียนอยู่ที่ API ไม่ได้ฝังใน GitHub
  SPREADSHEET_ID: '1TU2kC7kzJbb9JZzo4m7D3eOmcW8Ra_osic33rolE-Hw',
  REQUEST_TIMEOUT_MS: 30000,
  // 2.6.0: เจ้าหน้าที่/ผู้บริหาร และผลการดำเนินงาน ย้ายไปที่ ABM — ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร
  ABM_URL: 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/',
  ABM_API_URL: 'https://script.google.com/macros/s/AKfycby7nbXMQ3_WvA7y_Mp0DTE_wMX9eyiJQbfYBlpaQBOshpUyurOFgoM7MxWMN0wLvjkdqw/exec',
  BUILD_VERSION: '3.0.0',
  GEO_BASE: 'geo/',   // 3.0.0 boundary files of the 77 provinces (tools/geo/build.py)
  MINIMUM_API_VERSION: '1.3.1'
};
