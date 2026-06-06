// Generates realistic end-to-end staging fixtures exercising all six entity
// types through the migration pipeline. Run from the project root:
//   node scripts/make-staging-fixtures.mjs   (or: npx tsx scripts/...)
//
// Produces a single multi-sheet workbook (one sheet per entity type, sheet
// names matching the entity-detection convention) plus per-entity CSVs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../tests/fixtures/staging');
mkdirSync(outDir, { recursive: true });

/** name -> { headers, rows } */
const SHEETS = {
  Products: {
    headers: ['sku', 'name', 'category', 'price', 'currency'],
    rows: [
      ['TZ-KILI-7D', 'Kilimanjaro 7-Day Machame', 'trek', 2450, 'USD'],
      ['TZ-SAFARI-3D', 'Serengeti 3-Day Safari', 'safari', 1290, 'USD'],
      ['ZN-DIVE-2D', 'Zanzibar 2-Day Dive', 'water', 540, 'USD'],
      ['KE-MARA-4D', 'Masai Mara 4-Day', 'safari', 1680, 'USD'],
    ],
  },
  Travelers: {
    headers: ['email', 'fullName', 'phone'],
    rows: [
      ['ana.vidal@example.com', 'Ana Vidal', '+34600111222'],
      ['ben.okoro@example.com', 'Ben Okoro', '+2348012345678'],
      ['chen.li@example.com', 'Chen Li', '+8613800138000'],
      ['dana.k@example.com', 'Dana Kessler', '+14155550101'],
    ],
  },
  Guides: {
    headers: ['email', 'fullName'],
    rows: [
      ['juma.guide@example.com', 'Juma Mbeki'],
      ['sara.guide@example.com', 'Sara Nyong'],
      ['paul.guide@example.com', 'Paul Otieno'],
    ],
  },
  Qualifications: {
    headers: ['code', 'name', 'guide'],
    rows: [
      ['WFR', 'Wilderness First Responder', 'juma.guide@example.com'],
      ['MOUNT-L2', 'Mountain Guide Level 2', 'sara.guide@example.com'],
      ['DIVE-PADI', 'PADI Divemaster', 'paul.guide@example.com'],
    ],
  },
  Bookings: {
    headers: ['reference', 'product', 'traveler', 'start date'],
    rows: [
      ['BK-1001', 'TZ-KILI-7D', 'ana.vidal@example.com', '2026-07-10'],
      ['BK-1002', 'TZ-SAFARI-3D', 'ben.okoro@example.com', '2026-07-18'],
      ['BK-1003', 'ZN-DIVE-2D', 'chen.li@example.com', '2026-08-02'],
      ['BK-1004', 'KE-MARA-4D', 'dana.k@example.com', '2026-08-15'],
    ],
  },
  'Staffing Rules': {
    headers: ['name', 'product', 'qualification'],
    rows: [
      ['Kili requires WFR', 'TZ-KILI-7D', 'WFR'],
      ['Kili requires L2', 'TZ-KILI-7D', 'MOUNT-L2'],
      ['Dive requires PADI', 'ZN-DIVE-2D', 'DIVE-PADI'],
    ],
  },
};

const wb = new ExcelJS.Workbook();
for (const [sheetName, { headers, rows }] of Object.entries(SHEETS)) {
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);

  // Also emit a per-entity CSV for flexibility.
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
  const csvName = sheetName.toLowerCase().replace(/\s+/g, '-') + '.csv';
  writeFileSync(join(outDir, csvName), csv);
}

const xlsxPath = join(outDir, 'operator-migration-sample.xlsx');
await wb.xlsx.writeFile(xlsxPath);
console.log(`wrote ${xlsxPath} and per-entity CSVs to ${outDir}`);
