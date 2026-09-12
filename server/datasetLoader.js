import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const REQUIRED_COLUMNS = ['ชุดข้อมูล', 'หมวดหมู่/หัวข้อ', 'คำถาม', 'คำตอบ'];

/** Loads only the master sheet. The source workbook is never changed. */
export function loadDataset(datasetPath) {
  const absolutePath = path.resolve(datasetPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`ไม่พบไฟล์ Dataset: ${absolutePath}`);
  const workbook = XLSX.readFile(absolutePath, { cellText: true, cellDates: false });
  const sheet = workbook.Sheets['Dataset รวม'];
  if (!sheet) throw new Error('ไม่พบ Sheet "Dataset รวม" ในไฟล์ Dataset');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const columns = Object.keys(rows[0] || {});
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length) throw new Error(`Dataset ไม่มีคอลัมน์ที่จำเป็น: ${missing.join(', ')}`);

  const records = rows
    .filter((row) => String(row['คำถาม']).trim() && String(row['คำตอบ']).trim())
    .map((row, index) => ({
      id: String(row['ลำดับรวม'] || index + 1),
      dataset: String(row['ชุดข้อมูล']).trim(),
      category: String(row['หมวดหมู่/หัวข้อ']).trim(),
      question: String(row['คำถาม']).trim(),
      answer: String(row['คำตอบ']).trim()
    }));
  if (!records.length) throw new Error('ไม่พบแถวคำถาม–คำตอบที่ใช้งานได้ใน Dataset รวม');
  return { records, sourcePath: absolutePath, sheetName: 'Dataset รวม' };
}
