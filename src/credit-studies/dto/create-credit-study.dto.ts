import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCreditStudyDto {
  @ApiProperty({ example: 'customer-uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 1, description: 'Status parameter ID' })
  @Type(() => Number)
  @IsInt()
  statusId: number;

  @ApiProperty({ example: '2026-02-11', description: 'Study date' })
  @IsDateString()
  studyDate: string;

  @ApiPropertyOptional({
    example: '2026-03-01',
    description: 'Resolution date',
  })
  @IsOptional()
  @IsDateString()
  resolutionDate?: string;

  @ApiPropertyOptional({ example: 'Study observations' })
  @IsOptional()
  @IsString()
  notes?: string;

  // ── Solicitud ──────────────────────────────────────────

  @ApiPropertyOptional({ example: 12, description: 'Requested term (months)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestedTerm?: number;

  @ApiPropertyOptional({
    example: 50000000,
    description: 'Requested monthly credit line',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  requestedMonthlyCreditLine?: number;

  // ── Balance General ────────────────────────────────────

  @ApiPropertyOptional({
    example: 100000000,
    description: 'Balance sheet total',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  balanceSheet?: number;

  @ApiPropertyOptional({
    example: 5000000,
    description: 'Cash and equivalents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  cashAndEquivalents?: number;

  @ApiPropertyOptional({
    example: 10000000,
    description: 'Accounts receivable 1',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  accountsReceivable1?: number;

  @ApiPropertyOptional({
    example: 8000000,
    description: 'Accounts receivable 2',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  accountsReceivable2?: number;

  @ApiPropertyOptional({ example: 15000000, description: 'Inventories 1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  inventories1?: number;

  @ApiPropertyOptional({ example: 12000000, description: 'Inventories 2' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  inventories2?: number;

  @ApiPropertyOptional({
    example: 50000000,
    description: 'Total current assets',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalCurrentAssets?: number;

  @ApiPropertyOptional({
    example: 30000000,
    description: 'Fixed assets / property',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  fixedAssetsProperty?: number;

  @ApiPropertyOptional({
    example: 35000000,
    description: 'Total non-current assets',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalNonCurrentAssets?: number;

  @ApiPropertyOptional({ example: 85000000, description: 'Total assets' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalAssets?: number;

  @ApiPropertyOptional({
    example: 10000000,
    description: 'Short-term financial liabilities',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  shortTermFinancialLiabilities?: number;

  @ApiPropertyOptional({ example: 7000000, description: 'Suppliers 1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  suppliers1?: number;

  @ApiPropertyOptional({ example: 5000000, description: 'Suppliers 2' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  suppliers2?: number;

  @ApiPropertyOptional({
    example: 25000000,
    description: 'Total current liabilities',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalCurrentLiabilities?: number;

  @ApiPropertyOptional({
    example: 15000000,
    description: 'Long-term financial liabilities',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  longTermFinancialLiabilities?: number;

  @ApiPropertyOptional({
    example: 20000000,
    description: 'Total non-current liabilities',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalNonCurrentLiabilities?: number;

  @ApiPropertyOptional({ example: 45000000, description: 'Total liabilities' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  totalLiabilities?: number;

  @ApiPropertyOptional({ example: 20000000, description: 'Retained earnings' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  retainedEarnings?: number;

  @ApiPropertyOptional({ example: 40000000, description: 'Equity' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  equity?: number;

  // ── Estado de Resultados ───────────────────────────────

  @ApiPropertyOptional({
    example: 1,
    description: 'Income statement parameter ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  incomeStatementId?: number;

  @ApiPropertyOptional({
    example: 80000000,
    description: 'Ordinary activity revenue',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  ordinaryActivityRevenue?: number;

  @ApiPropertyOptional({ example: 50000000, description: 'Cost of sales' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  costOfSales?: number;

  @ApiPropertyOptional({ example: 30000000, description: 'Gross profit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  grossProfit?: number;

  @ApiPropertyOptional({
    example: 5000000,
    description: 'Administrative expenses',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  administrativeExpenses?: number;

  @ApiPropertyOptional({ example: 3000000, description: 'Selling expenses' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  sellingExpenses?: number;

  @ApiPropertyOptional({
    example: 2000000,
    description: 'Depreciation and amortization',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  depreciationAmortization?: number;

  @ApiPropertyOptional({ example: 1500000, description: 'Financial expenses' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  financialExpenses?: number;

  @ApiPropertyOptional({ example: 3000000, description: 'Taxes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  taxes?: number;

  @ApiPropertyOptional({ example: 15500000, description: 'Net income' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  netIncome?: number;
}
