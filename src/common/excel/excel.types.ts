export type ExcelColumnType =
  | 'string'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'boolean';

export interface ExcelColumn<T = any> {
  header: string;
  key: keyof T & string;
  type?: ExcelColumnType;
  width?: number;
  format?: string;
}

export interface ExcelSheet<T = any> {
  name: string;
  columns: ExcelColumn<T>[];
  data: T[];
}

export interface ExcelExportOptions {
  fileName: string;
  sheets: ExcelSheet[];
}
