import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type {
  ExcelColumn,
  ExcelColumnType,
  ExcelExportOptions,
  ExcelSheet,
} from './excel.types.js';

@Injectable()
export class ExcelService {
  async generate(options: ExcelExportOptions): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    for (const sheet of options.sheets) {
      this.buildSheet(workbook, sheet);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

    const fileName = options.fileName.endsWith('.xlsx')
      ? options.fileName
      : `${options.fileName}.xlsx`;

    return { buffer, fileName };
  }

  private buildSheet(workbook: ExcelJS.Workbook, sheet: ExcelSheet) {
    const worksheet = workbook.addWorksheet(sheet.name);

    worksheet.columns = sheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? 20,
      style: { numFmt: this.resolveFormat(col) },
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    for (const item of sheet.data) {
      const source = item as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      for (const col of sheet.columns) {
        row[col.key] = this.normalizeValue(source[col.key], col.type);
      }
      worksheet.addRow(row);
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }

  private resolveFormat(col: ExcelColumn): string {
    if (col.format) return col.format;
    switch (col.type) {
      case 'currency':
        return '"$"#,##0.00';
      case 'number':
        return '#,##0.##';
      case 'date':
        return 'yyyy-mm-dd';
      case 'datetime':
        return 'yyyy-mm-dd hh:mm';
      default:
        return 'General';
    }
  }

  private normalizeValue(value: unknown, type?: ExcelColumnType): unknown {
    if (value === null || value === undefined) return null;

    switch (type) {
      case 'date':
      case 'datetime':
        return value instanceof Date ? value : new Date(value as string);
      case 'number':
      case 'currency':
        return typeof value === 'number' ? value : Number(value);
      case 'boolean':
        return value ? 'Sí' : 'No';
      default:
        return value;
    }
  }
}
