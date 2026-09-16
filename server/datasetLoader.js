import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

export const DATASET_SHEET = 'Dataset รวม';
export const REQUIRED_COLUMNS = ['ID', 'Dataset', 'Category', 'Topic', 'Intent', 'Entities', 'Question', 'Search_Aliases', 'Answer', 'Source', 'Source_Page', 'Source_Excerpt', 'Confidence', 'Search_Text'];

const value = (row, name) => String(row[name] ?? '').trim();
const aliases = (text) => String(text ?? '').split('|').map((item) => item.trim()).filter(Boolean);

/** Reads the named worksheet by header, never by positional column index. */
export function loadDataset(datasetPath) {
  const absolutePath = path.resolve(datasetPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Dataset file not found: ${absolutePath}`);
  const workbook = XLSX.readFile(absolutePath, { cellText: true, cellDates: false });
  const sheet = workbook.Sheets[DATASET_SHEET];
  if (!sheet) throw new Error(`Dataset format error: worksheet "${DATASET_SHEET}" was not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const columns = Object.keys(rows[0] || {});
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length) throw new Error(`Dataset format error: missing required columns: ${missing.join(', ')}`);

  const validationErrors = []; const ids = new Set();
  const records = rows.map((row, index) => {
    const rowNumber = index + 2; const id = value(row, 'ID'); const dataset = value(row, 'Dataset'); const question = value(row, 'Question'); const answer = value(row, 'Answer');
    if (!id) validationErrors.push(`row ${rowNumber}: ID is blank`); else if (ids.has(id)) validationErrors.push(`row ${rowNumber}: duplicate ID "${id}"`); else ids.add(id);
    if (!dataset) validationErrors.push(`row ${rowNumber}: Dataset is blank`);
    if (!question) validationErrors.push(`row ${rowNumber}: Question is blank`);
    if (!answer) validationErrors.push(`row ${rowNumber}: Answer is blank`);
    return { id, dataset, category: value(row, 'Category'), topic: value(row, 'Topic'), intent: value(row, 'Intent'), entities: value(row, 'Entities'), question, searchAliases: aliases(row.Search_Aliases), answer, source: value(row, 'Source'), sourcePage: value(row, 'Source_Page'), sourceExcerpt: value(row, 'Source_Excerpt'), confidence: value(row, 'Confidence'), searchText: value(row, 'Search_Text') };
  });
  if (validationErrors.length) throw new Error(`Dataset validation failed (${validationErrors.length} issue(s)):\n${validationErrors.slice(0, 30).join('\n')}${validationErrors.length > 30 ? '\n…additional issues omitted' : ''}`);
  const datasetHash = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  return { records, sourcePath: absolutePath, sheetName: DATASET_SHEET, columns, datasetHash };
}
