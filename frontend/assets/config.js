window.GGH_CONFIG = {
  // Apps Script Web App (/exec) ของ Green Gain Hub KPP API (ไม่ใช่ Smart Agri-Materials)
  // ใช้ทั้งระบบสมาชิก (?action=rpc) และ Dashboard สาธารณะ (?api=v1&endpoint=summary)
  SHEETS_API_URL: 'https://script.google.com/macros/s/AKfycbylUGpPc7g9ODTrt-sodEwAa4G3mx8yP-Rve4lqllPyHGxpZkiuLkNcprQ3p_pVB7WT/exec',
  // Dashboard สาธารณะ (ว่าง = ใช้ SHEETS_API_URL)
  SUMMARY_API_URL: '',
  // ต้องตรงกับ Script Property SUMMARY_API_KEY ถ้าตั้งไว้ (คีย์นี้มองเห็นได้จากหน้าเว็บ ไม่ใช่รหัสลับ)
  SUMMARY_API_KEY: '',
  // ใช้เพื่อแสดงอ้างอิงเท่านั้น สิทธิ์อ่าน/เขียนอยู่ที่ API ไม่ได้ฝังใน GitHub
  SPREADSHEET_ID: '1TU2kC7kzJbb9JZzo4m7D3eOmcW8Ra_osic33rolE-Hw',
  REQUEST_TIMEOUT_MS: 30000,
  BUILD_VERSION: '1.6.0',
  MINIMUM_API_VERSION: '1.3.1'
};
