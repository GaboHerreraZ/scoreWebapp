import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AnalysisPacksRepository } from './analysis-packs.repository.js';
import { PackOfferingsRepository } from '../pack-offerings/pack-offerings.repository.js';
import { ConsultationPricesService } from '../consultation-prices/consultation-prices.service.js';
import { EpaycoService } from '../epayco/epayco.service.js';
import { PurchasePackDto } from './dto/purchase-pack.dto.js';
import { PackConfirmationDto } from './dto/pack-confirmation.dto.js';
import {
  calculatePackPrice,
  type DiscountTypeCode,
} from '../common/utils/pack-pricing.js';

@Injectable()
export class AnalysisPacksService {
  private readonly logger = new Logger(AnalysisPacksService.name);

  constructor(
    private readonly repository: AnalysisPacksRepository,
    private readonly packOfferingsRepository: PackOfferingsRepository,
    private readonly consultationPricesService: ConsultationPricesService,
    private readonly epaycoService: EpaycoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inicia la compra de un pack: crea la AnalysisPack en pending_payment con el
   * precio CONGELADO y devuelve los datos del checkout onepage de ePayco para
   * que el front abra el widget. La confirmación llega por webhook (no aquí).
   */
  async purchase(companyId: string, dto: PurchasePackDto) {
    const offering = await this.packOfferingsRepository.findById(
      dto.packOfferingId,
    );
    if (!offering || !offering.isActive || !offering.isCurrent) {
      throw new NotFoundException(
        'La oferta de bolsa no existe o ya no está disponible',
      );
    }

    const activePrice = await this.consultationPricesService.getActivePrice();
    if (!activePrice) {
      throw new BadRequestException(
        'No hay un precio de consulta activo configurado. No es posible cotizar la compra.',
      );
    }

    // Precio congelado al momento de la compra (derivado del precio vigente).
    const discountTypeCode = offering.discountType?.code as
      | DiscountTypeCode
      | undefined;
    const pricing = calculatePackPrice({
      quantity: offering.quantity,
      unitPrice: activePrice.unitPrice,
      hasDiscount: offering.hasDiscount,
      discountTypeCode,
      discountValue: offering.discountValue,
    });

    if (pricing.total <= 0) {
      throw new BadRequestException(
        'El monto de la compra no es válido para procesar el pago',
      );
    }

    // Vigencia: hoy → hoy + validityDays.
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + offering.validityDays);

    const pendingStatus = await this.repository.findParameterByTypeAndCode(
      'analysis_pack_status',
      'pending_payment',
    );
    if (!pendingStatus) {
      throw new BadRequestException(
        'Falta el parámetro de estado de bolsa (pending_payment)',
      );
    }

    const paymentToken = randomBytes(32).toString('hex');

    const pack = await this.repository.create({
      companyId,
      packOfferingId: offering.id,
      quantityPurchased: offering.quantity,
      quantityConsumed: 0,
      startDate,
      endDate,
      unitPricePaid: pricing.unitPrice,
      totalPaid: pricing.total,
      currencyCode: activePrice.currencyCode,
      consultationPriceId: activePrice.id,
      statusId: pendingStatus.id,
      paymentToken,
    });

    // invoice = referencia única propia que ePayco devuelve en la confirmación.
    const invoice = `PACK-${pack.id}`;
    const backendUrl = this.configService.get<string>(
      'BACKEND_PUBLIC_URL',
      'http://localhost:3000',
    );

    const checkout = this.epaycoService.buildCheckoutData({
      invoice,
      amount: pricing.total,
      name: offering.name,
      description: `${offering.quantity} consultas (análisis de crédito)`,
      currency: activePrice.currencyCode,
      extra1: pack.id, // el webhook lo recibe para identificar la bolsa
      confirmationUrl: `${backendUrl}/api/webhooks/epayco/packs`,
    });

    this.logger.log(
      `Empresa ${companyId} inició compra de pack ${pack.id} (oferta ${offering.id}, total ${pricing.total} ${activePrice.currencyCode})`,
    );

    return {
      analysisPackId: pack.id,
      invoice,
      checkout,
      pricing: {
        quantity: offering.quantity,
        unitPrice: pricing.unitPrice,
        subtotal: pricing.subtotal,
        discountAmount: pricing.discountAmount,
        total: pricing.total,
        currency: activePrice.currencyCode,
      },
      validity: { startDate, endDate },
    };
  }

  /** Bolsas de una empresa (historial). */
  async findByCompany(companyId: string) {
    return this.repository.findByCompany(companyId);
  }

  /**
   * Saldo de consultas de una empresa: total disponible y detalle de las bolsas
   * activas y vigentes (con su saldo y vencimiento), para que el front lo muestre.
   */
  async getBalance(companyId: string) {
    const activeStatus = await this.repository.findParameterByTypeAndCode(
      'analysis_pack_status',
      'active',
    );
    if (!activeStatus) {
      return { availableCredits: 0, packs: [] };
    }

    const packs = await this.repository.findActivePacksWithBalance(
      companyId,
      activeStatus.id,
    );

    let availableCredits = 0;
    const detail = packs.map((p) => {
      const remaining = p.quantityPurchased - p.quantityConsumed;
      availableCredits += remaining;
      return {
        id: p.id,
        quantityPurchased: p.quantityPurchased,
        quantityConsumed: p.quantityConsumed,
        remaining,
        startDate: p.startDate,
        endDate: p.endDate,
      };
    });

    return { availableCredits, packs: detail };
  }

  /**
   * Procesa la confirmación POST de ePayco para la compra de un pack. Valida
   * firma, idempotencia por transacción, y activa la bolsa si el pago fue
   * aceptado (cod_response=1). El id de la bolsa viaja en x_extra1.
   */
  async handleConfirmation(dto: PackConfirmationDto) {
    this.logger.log(
      `Webhook pack recibido: ref=${dto.x_ref_payco}, cod_response=${dto.x_cod_response}, extra1=${dto.x_extra1}`,
    );

    // 1. Validar firma
    const isValid = this.epaycoService.validateConfirmationSignature({
      refPayco: dto.x_ref_payco,
      transactionId: dto.x_transaction_id,
      amount: dto.x_amount,
      currencyCode: dto.x_currency_code,
      signature: dto.x_signature,
    });
    if (!isValid) {
      this.logger.warn(`Firma ePayco inválida para ref=${dto.x_ref_payco}`);
      throw new BadRequestException('Firma inválida');
    }

    // 2. Identificar la bolsa por x_extra1
    const packId = dto.x_extra1;
    if (!packId) {
      throw new BadRequestException('Falta la referencia de la bolsa (extra1)');
    }
    const pack = await this.repository.findById(packId);
    if (!pack) {
      this.logger.warn(`Bolsa no encontrada para extra1=${packId}`);
      throw new NotFoundException(`Bolsa no encontrada (${packId})`);
    }

    // 3. Idempotencia por transacción
    if (dto.x_transaction_id) {
      const already = await this.repository.existsByTransactionId(
        dto.x_transaction_id,
      );
      if (already) {
        this.logger.log(
          `Webhook duplicado ignorado: transacción=${dto.x_transaction_id}`,
        );
        return { received: true };
      }
    }

    const [pendingStatus, activeStatus, cancelledStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'pending_payment',
      ),
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'active',
      ),
      this.repository.findParameterByTypeAndCode(
        'analysis_pack_status',
        'cancelled',
      ),
    ]);
    if (!pendingStatus || !activeStatus || !cancelledStatus) {
      throw new BadRequestException('Faltan parámetros de estado de bolsa');
    }

    const responseCode = parseInt(dto.x_cod_response ?? '0', 10);

    if (responseCode === 1) {
      // Pago aceptado → activar la bolsa (claim atómico pending → active).
      const activated = await this.repository.activateAfterConfirmation({
        packId: pack.id,
        pendingStatusId: pendingStatus.id,
        activeStatusId: activeStatus.id,
        epaycoRef: dto.x_ref_payco,
        epaycoTransactionId: dto.x_transaction_id,
      });
      this.logger.log(
        activated
          ? `Bolsa ${pack.id} ACTIVADA por confirmación de pago (ref=${dto.x_ref_payco})`
          : `Bolsa ${pack.id} ya estaba activada (webhook concurrente, ref=${dto.x_ref_payco})`,
      );
    } else if (responseCode === 2 || responseCode === 4) {
      // Rechazado/fallido → cancelar la bolsa pendiente.
      await this.repository.markCancelled(
        pack.id,
        pendingStatus.id,
        cancelledStatus.id,
        dto.x_ref_payco,
        dto.x_transaction_id,
      );
      this.logger.warn(
        `Pago de bolsa ${pack.id} rechazado/fallido (código=${responseCode}, ref=${dto.x_ref_payco})`,
      );
    } else {
      // Pendiente (3) u otro → no hacemos nada; esperamos una confirmación final.
      this.logger.log(
        `Bolsa ${pack.id} pendiente de confirmación (código=${responseCode}, ref=${dto.x_ref_payco})`,
      );
    }

    return { received: true };
  }
}
