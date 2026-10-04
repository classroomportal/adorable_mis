#!/usr/bin/env node
// Exports every sheet of an Excel workbook to its own CSV file.
//
//   node scripts/xlsx-to-csv.js <workbook.xlsx>
//
// The CSVs go in the folder the workbook is in, named after the workbook and
// the sheet: FET_timetable_data.xlsx with a "Teachers" sheet gives
// FET_timetable_data - Teachers.csv. Existing files of the same name are
// overwritten. Written for the FET timetable data export (one sheet per FET
// import file), but works on any .xlsx/.xls/.ods the xlsx package can read.
//
// Cells are written as Excel shows them (formatted text, not raw numbers),
// blank rows are kept so row numbers still line up with the sheet, and the
// file is UTF-8 with a byte-order mark so Excel opens names with accents
// correctly.

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Characters Windows, macOS or Linux won't take in a file name.
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'Sheet';
}

function exportSheets(workbookPath) {
  const wb = XLSX.readFile(workbookPath);
  const dir = path.dirname(path.resolve(workbookPath));
  const base = path.basename(workbookPath, path.extname(workbookPath));
  const written = [];

  for (const sheetName of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: true });
    const file = path.join(dir, `${base} - ${safeFileName(sheetName)}.csv`);
    fs.writeFileSync(file, `﻿${csv}`, 'utf8');
    written.push({ sheet: sheetName, file, rows: csv ? csv.split('\n').length : 0 });
  }
  return written;
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/xlsx-to-csv.js <workbook.xlsx>');
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`No such file: ${input}`);
    process.exit(1);
  }
  for (const { sheet, file, rows } of exportSheets(input)) {
    console.log(`${sheet}: ${rows} rows -> ${file}`);
  }
}

module.exports = { exportSheets };
