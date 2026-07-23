# Deploy Green Gain Hub 1.2.0

Repository: `Krit-PJ/Green_Gain_Hub-KPP`

## 1. Update Apps Script first

1. Open the Google Sheet and choose **Extensions > Apps Script**.
2. Replace all code in `Code.gs` with `apps-script/Code.gs` from this package, then save.
3. Run `setupSystem()` once. It verifies the schema, restores legacy `Expired` farmers to `Open`, clears the old expiry rule, removes the legacy trigger, and must return PASS.
4. Choose **Deploy > Manage deployments > Edit > New version > Deploy**. Keep **Execute as: Me** and **Who has access: Anyone**.
5. Keep the existing Web App URL ending in `AKfycbxdispDx1h_HQ_6N4-GeKP3l6f8tuo4LdPvao5e8qUuUPIOxae1k-dWn9fVj44FlRnJ/exec`.

## 2. Copy this package into the repository root

The repository root must contain `.github`, `frontend`, `apps-script`, `tests`, and the Markdown files directly. Do not upload the outer package folder as an extra nested level.

## 3. GitHub Desktop

1. Open `Krit-PJ/Green_Gain_Hub-KPP`.
2. Choose **Repository > Show in Explorer**.
3. Copy every item from this package into that folder, including `.github`.
4. Commit to `main` with `Deploy Green Gain Hub 1.2.0`.
5. Push origin.

## 4. GitHub Pages

1. Open **Settings > Pages**.
2. Select **GitHub Actions** as the source.
3. Open **Actions** and wait for `Deploy Green Gain Hub to GitHub Pages` to finish successfully.

Production URL:

`https://krit-pj.github.io/Green_Gain_Hub-KPP/`

## 5. Verify

- Register a new telephone number.
- Log in and save one farmer record and one buyer record.
- Refresh and confirm both records reload from Google Sheets.
- Verify `Other` requires a custom material name.
- Verify a farmer record with status `Open` and valid coordinates remains visible even after harvest date +10 days.
- Verify the buyer form saves and reloads “ทั้งหมด” and the selected 1–15 days after harvest.
- Log in as a farmer and confirm the buyer card/pin shows the selected number of days.
- Log in as a buyer, open the map, and confirm “ช่วงเวลาเก็บเกี่ยวผลผลิต” supports “ทั้งหมด”, shows the current Buddhist year first, and lists other available years below it.
- Select “ทั้งหมด” and confirm every `Open` farmer with coordinates is shown without a harvest-date, year, or month filter.
- Select a Buddhist year plus a start and end month, then confirm the farmer cards, green pins, and result count update together.
- Log in as a farmer and confirm buyer pins are blue. Confirm editable location pins follow the same role colors.
