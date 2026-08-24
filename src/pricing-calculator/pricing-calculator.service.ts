import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import {
  SimulatePricingDto,
  PricingTechnique,
} from './dto/simulate-pricing.dto.js';

const CURRENCY = 'COP';
const DEFAULT_PACK_SIZES = [1, 5, 10, 25, 50, 100, 200];

const round = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 10) / 10;

/**
 * Metadatos de cada técnica: fórmula y explicación pensadas para mostrarse
 * tal cual en el front-end.
 */
const TECHNIQUE_INFO: Record<
  PricingTechnique,
  { label: string; formula: string; reference: string; explanation: string }
> = {
  [PricingTechnique.EXPONENTIAL]: {
    label: 'Decaimiento exponencial hacia el piso',
    formula: 'p(q) = piso + (P₀ − piso) · e^(−k·(q−1))',
    reference:
      'Precios no lineales / discriminación de precios de 2º grado (Robert Wilson, "Nonlinear Pricing", 1993)',
    explanation:
      'El precio por consulta arranca en el precio vigente (P₀) y baja de forma ' +
      'exponencial hacia un piso que nunca se perfora: el descuento crece rápido ' +
      'en las bolsas pequeñas y medianas (donde motiva a subir de bolsa) y se ' +
      'aplana en las grandes (donde ya no es necesario regalar margen). El ' +
      'parámetro k se calibra automáticamente para que la bolsa más grande quede ' +
      'prácticamente en el piso. Es el esquema típico de los precios por créditos ' +
      'o consumo de APIs (Twilio, SendGrid, OpenAI).',
  },
  [PricingTechnique.POWER]: {
    label: 'Curva de experiencia (ley de potencia)',
    formula: 'p(q) = P₀ · q^(−ε)',
    reference:
      'Curva de experiencia BCG (Bruce Henderson, 1968) y descuentos por cantidad (Dolan, 1987)',
    explanation:
      'El precio por consulta cae un porcentaje fijo cada vez que la cantidad se ' +
      'duplica (comportamiento log-log lineal). El exponente ε se calibra para ' +
      'tocar el piso exactamente en la bolsa más grande. Comparada con la ' +
      'exponencial, da descuentos más agresivos desde las bolsas pequeñas: útil ' +
      'cuando el objetivo principal es empujar al cliente a bolsas medianas.',
  },
  [PricingTechnique.LINEAR]: {
    label: 'Descuento lineal',
    formula: 'p(q) = P₀ − (P₀ − piso) · (q−1)/(Q−1)',
    reference: 'Descuento proporcional simple (sin curva)',
    explanation:
      'El precio por consulta baja la misma cantidad de pesos por cada consulta ' +
      'adicional hasta llegar al piso en la bolsa más grande (Q). Es la más ' +
      'fácil de comunicar, pero reparte el descuento parejo: entrega margen en ' +
      'bolsas medianas donde las otras técnicas lo conservan.',
  },
};

@Injectable()
export class PricingCalculatorService {
  constructor(private readonly consultationPrices: ConsultationPricesService) {}

  /**
   * Genera el menú de bolsas de consultas. El precio base (P₀) es SIEMPRE el
   * precio de consulta activo en BD; el front solo define el piso, la técnica
   * y opcionalmente tamaños, costo variable y costos fijos.
   */
  async simulate(dto: SimulatePricingDto) {
    const active = await this.consultationPrices.getActivePrice();
    if (!active) {
      throw new ConflictException(
        'No hay un precio de consulta activo. Cree uno en Precios de Consulta antes de simular bolsas.',
      );
    }

    const p0 = active.unitPrice;
    const floor = dto.floorPrice;
    const technique = dto.technique ?? PricingTechnique.EXPONENTIAL;
    const charm = dto.charmRounding ?? true;

    if (floor >= p0) {
      throw new BadRequestException(
        `El piso (${floor}) debe ser menor al precio activo (${p0})`,
      );
    }

    const packSizes = this.resolvePackSizes(dto.packSizes);
    const qMax = packSizes[packSizes.length - 1];
    // Default: la bolsa más pequeña siempre va a precio lleno (0% descuento);
    // la curva empieza a descontar a partir de ella.
    const qStart = dto.discountStartQuantity ?? packSizes[0];
    const strength = dto.curveStrength ?? 1;

    if (
      dto.discountStartQuantity != null &&
      dto.discountStartQuantity >= qMax
    ) {
      throw new BadRequestException(
        `discountStartQuantity (${dto.discountStartQuantity}) debe ser menor a la bolsa más grande (${qMax}); de lo contrario ninguna bolsa tendría descuento`,
      );
    }

    const { priceAt, params } = this.buildCurve(
      technique,
      p0,
      floor,
      qMax,
      qStart,
      strength,
    );

    const warnings: string[] = [];
    if (dto.variableCost != null && floor < dto.variableCost) {
      warnings.push(
        `El piso ($${floor.toLocaleString('es-CO')}) está por debajo del costo variable ($${dto.variableCost.toLocaleString('es-CO')}): la bolsa más grande vendería a pérdida.`,
      );
    }

    // Construcción de bolsas
    let prevTotal = 0;
    let prevQty = 0;
    const packs = packSizes.map((q) => {
      const unitRaw = Math.max(floor, priceAt(q));
      let total = unitRaw * q;

      // Bolsas a precio lleno (bajo el umbral de descuento) no se redondean:
      // el descuento debe ser exactamente 0%.
      if (charm && q > 1 && unitRaw < p0) {
        // Mayor total terminado en .999 que NO supere el precio sin redondear
        // (el ahorro nunca puede ser negativo), sin perforar el piso.
        const charmDown = Math.floor((total + 1) / 1000) * 1000 - 1;
        const floorGuard = Math.ceil((floor * q) / 1000) * 1000 - 1;
        total = Math.max(charmDown, floorGuard);
      }
      if (total <= prevTotal) {
        total = prevTotal + 1000; // salvaguarda de monotonía tras redondear
        warnings.push(
          `La bolsa de ${q} se ajustó para costar más que la anterior (revise los tamaños de bolsa).`,
        );
      }

      const unitEffective = total / q;
      const marginalPrice =
        prevQty > 0 ? (total - prevTotal) / (q - prevQty) : null;

      if (
        dto.variableCost != null &&
        marginalPrice != null &&
        marginalPrice < dto.variableCost
      ) {
        warnings.push(
          `Al pasar de ${prevQty} a ${q} consultas, el precio marginal ($${round(marginalPrice).toLocaleString('es-CO')}/consulta extra) queda por debajo del costo variable.`,
        );
      }

      const marginPerUnit =
        dto.variableCost != null ? unitEffective - dto.variableCost : null;

      const pack = {
        quantity: q,
        totalPrice: round(total),
        unitPrice: round(unitEffective),
        discountPercent: pct((1 - unitEffective / p0) * 100),
        savings: round(p0 * q - total),
        marginalPrice: marginalPrice != null ? round(marginalPrice) : null,
        marginPerUnit: marginPerUnit != null ? round(marginPerUnit) : null,
        marginPercent:
          marginPerUnit != null
            ? pct((marginPerUnit / unitEffective) * 100)
            : null,
        breakEvenUnits:
          dto.fixedCosts != null && marginPerUnit != null && marginPerUnit > 0
            ? Math.ceil(dto.fixedCosts / marginPerUnit)
            : null,
      };

      prevTotal = total;
      prevQty = q;
      return pack;
    });

    this.checkSelfSelection(packs, warnings);

    const info = TECHNIQUE_INFO[technique];
    return {
      currencyCode: CURRENCY,
      activePrice: {
        id: active.id,
        name: active.name,
        unitPrice: round(p0),
      },
      technique: {
        id: technique,
        label: info.label,
        formula: info.formula,
        params,
        reference: info.reference,
        explanation: info.explanation,
      },
      base: {
        unitPrice: round(p0),
        floorPrice: round(floor),
        maxDiscountPercent: pct((1 - floor / p0) * 100),
        variableCost: dto.variableCost != null ? round(dto.variableCost) : null,
        fixedCosts: dto.fixedCosts != null ? round(dto.fixedCosts) : null,
        breakEvenUnitsFull:
          dto.fixedCosts != null &&
          dto.variableCost != null &&
          p0 > dto.variableCost
            ? Math.ceil(dto.fixedCosts / (p0 - dto.variableCost))
            : null,
      },
      packs,
      warnings,
    };
  }

  /**
   * Curva de precio unitario según la técnica. Arranca en P₀ en qStart (las
   * cantidades menores quedan a precio lleno) y se calibra al piso en qMax.
   */
  private buildCurve(
    technique: PricingTechnique,
    p0: number,
    floor: number,
    qMax: number,
    qStart: number,
    strength: number,
  ): { priceAt: (q: number) => number; params: Record<string, number> } {
    if (qMax <= qStart) {
      return { priceAt: () => p0, params: { discountStartQuantity: qStart } };
    }

    switch (technique) {
      case PricingTechnique.EXPONENTIAL: {
        // k tal que en qMax se recorrió el 98% del camino al piso;
        // strength (>1) acelera el descuento inicial.
        const k = (strength * Math.log(50)) / (qMax - qStart);
        return {
          priceAt: (q) =>
            q <= qStart
              ? p0
              : floor + (p0 - floor) * Math.exp(-k * (q - qStart)),
          params: {
            k: Math.round(k * 10000) / 10000,
            discountStartQuantity: qStart,
            curveStrength: strength,
          },
        };
      }
      case PricingTechnique.POWER: {
        // ε tal que p(qMax) = piso exactamente (medido desde qStart).
        const epsilon = Math.log(p0 / floor) / Math.log(qMax / qStart);
        return {
          priceAt: (q) =>
            q <= qStart ? p0 : p0 * Math.pow(q / qStart, -epsilon),
          params: {
            epsilon: Math.round(epsilon * 10000) / 10000,
            discountStartQuantity: qStart,
          },
        };
      }
      case PricingTechnique.LINEAR: {
        const slope = (p0 - floor) / (qMax - qStart);
        return {
          priceAt: (q) => (q <= qStart ? p0 : p0 - slope * (q - qStart)),
          params: {
            slopePerUnit: round(slope),
            discountStartQuantity: qStart,
          },
        };
      }
    }
  }

  /**
   * Regla de auto-selección (Dolan): comprar varias bolsas chicas nunca debe
   * salir más barato que la bolsa grande equivalente.
   */
  private checkSelfSelection(
    packs: { quantity: number; totalPrice: number }[],
    warnings: string[],
  ) {
    for (let i = 1; i < packs.length; i++) {
      for (let j = 0; j < i; j++) {
        const combos = Math.ceil(packs[i].quantity / packs[j].quantity);
        if (combos * packs[j].totalPrice < packs[i].totalPrice) {
          warnings.push(
            `Comprar ${combos} bolsas de ${packs[j].quantity} sale más barato que la bolsa de ${packs[i].quantity}: ajuste los tamaños o el piso.`,
          );
        }
      }
    }
  }

  private resolvePackSizes(input?: number[]): number[] {
    const source = input && input.length ? input : DEFAULT_PACK_SIZES;
    const unique = Array.from(
      new Set(source.map((n) => Math.max(1, Math.floor(n)))),
    ).sort((a, b) => a - b);
    return unique;
  }
}
