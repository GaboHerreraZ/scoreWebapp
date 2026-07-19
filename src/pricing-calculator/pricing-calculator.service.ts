import { BadRequestException, Injectable } from '@nestjs/common';
import { SimulatePricingDto } from './dto/simulate-pricing.dto.js';

const CURRENCY = 'COP';
const DEFAULT_BREAKPOINTS = [1, 101, 301, 501, 1001, 2001];

const round = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class PricingCalculatorService {
  /**
   * Calculadora de descuentos por volumen. No persiste nada: recibe los datos
   * crudos del front y GENERA los tramos con su descuento sugerido.
   *
   * Idea base: el descuento sale del margen de contribución, no de los costos
   * fijos. El piso de negocio es costo variable + margen mínimo a conservar;
   * ese piso define el descuento máximo. Los tramos reparten el descuento de
   * 0% (volumen bajo) hasta ese máximo (volumen alto).
   */
  simulate(dto: SimulatePricingDto) {
    const { unitPrice, variableCost, minMarginAmount, fixedCosts } = dto;

    if (variableCost >= unitPrice) {
      throw new BadRequestException(
        'El costo variable iguala o supera el precio: no hay margen de contribución para calcular descuentos',
      );
    }

    const contributionMargin = unitPrice - variableCost;

    // Piso de negocio y descuento máximo permitido.
    const floorPrice = variableCost + minMarginAmount;
    const maxDiscountPercent = Math.max(
      0,
      ((unitPrice - floorPrice) / unitPrice) * 100,
    );

    const breakEvenUnitsFull = Math.ceil(fixedCosts / contributionMargin);

    // Cortes de volumen: ordenados, sin duplicados.
    const breakpoints = this.resolveBreakpoints(dto.volumeBreakpoints);

    const tiers = breakpoints.map((minQuantity, index) => {
      const isLast = index === breakpoints.length - 1;
      const maxQuantity = isLast ? null : breakpoints[index + 1] - 1;

      // Descuento repartido linealmente de 0 (primer tramo) al máximo (último),
      // redondeado a entero y nunca por encima del piso de negocio.
      const raw =
        breakpoints.length > 1
          ? (maxDiscountPercent * index) / (breakpoints.length - 1)
          : 0;
      const discountPercent = Math.min(
        Math.round(raw),
        Math.floor(maxDiscountPercent),
      );

      const price = unitPrice * (1 - discountPercent / 100);
      const marginPerUnit = price - variableCost;
      const marginPercent = price > 0 ? (marginPerUnit / price) * 100 : 0;
      const breakEvenUnits =
        marginPerUnit > 0 ? Math.ceil(fixedCosts / marginPerUnit) : null;

      return {
        label: this.buildLabel(minQuantity, maxQuantity),
        minQuantity,
        maxQuantity,
        discountPercent: pct(discountPercent),
        price: round(price),
        marginPerUnit: round(marginPerUnit),
        marginPercent: pct(marginPercent),
        breakEvenUnits,
      };
    });

    return {
      currencyCode: CURRENCY,
      base: {
        unitPrice: round(unitPrice),
        variableCost: round(variableCost),
        variableCostPercent: pct((variableCost / unitPrice) * 100),
        contributionMargin: round(contributionMargin),
        contributionMarginPercent: pct((contributionMargin / unitPrice) * 100),
        minMarginAmount: round(minMarginAmount),
        floorPrice: round(floorPrice),
        maxDiscountPercent: pct(maxDiscountPercent),
        fixedCosts: round(fixedCosts),
        breakEvenUnitsFull,
      },
      tiers,
    };
  }

  private resolveBreakpoints(input?: number[]): number[] {
    const source = input && input.length ? input : DEFAULT_BREAKPOINTS;
    const unique = Array.from(new Set(source)).sort((a, b) => a - b);
    return unique;
  }

  private buildLabel(min: number, max: number | null): string {
    const fmt = (n: number) => n.toLocaleString('es-CO');
    return max == null
      ? `${fmt(min)}+ consultas`
      : `${fmt(min)} - ${fmt(max)} consultas`;
  }
}
