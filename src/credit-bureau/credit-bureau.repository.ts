import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { toJson } from '../common/utils/prisma-json.util.js';
import type {
  MappedConsultationMeta,
  MappedCustomer,
  MappedRiskSnapshot,
} from './providers/provider-result.js';

export interface PersistConsultationParams {
  companyId: string;
  userId: string;
  provider: string; // nombre del proveedor ('experian'...)
  personTypeId: number; // Parameter person_type (naturalPerson | legalEntity)
  identificationTypeId: number | null; // Parameter identification_type
  meta: MappedConsultationMeta;
  customer: MappedCustomer; // no-null: solo se persiste si hubo información
  risk: MappedRiskSnapshot | null;
  rawResponse: unknown; // respuesta cruda COMPLETA del proveedor
  httpStatus: number;
  // Email de contacto a persistir en Customer.email: el del bureau (PJ) o, si
  // la central no trae, el titularEmail que viajó en la petición (el mismo al
  // que se envió la autorización). NUNCA pisa un email ya guardado.
  contactEmail: string | null;
  // Contacto de la central para sembrar el Customer SOLO al crearlo (luego es
  // editable vía PATCH y el refresh no lo pisa). PN llega todo null.
  contactSeed: {
    phone: string | null;
    city: string | null;
    address: string | null;
    economicActivityId: number | null;
  };
  // Primer representante legal principal (solo PJ), sembrado solo al crear.
  legalRepSeed: {
    name: string;
    identificationTypeId: number | null;
    identificationNumber: string | null;
  } | null;
  // titularEmail del from-bureau (solo PJ): correo del representante legal.
  // Create: se siembra; update: solo si está null.
  legalRepEmailFallback: string | null;
}

@Injectable()
export class CreditBureauRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste una consulta CON información en una sola transacción:
   *  1. upsert del Customer (identidad + último estado ligero) — por
   *     (companyId, identificationNumber).
   *  2. insert del snapshot inmutable (CreditBureauConsultation) con rawResponse.
   *  3. insert del CustomerRiskSnapshot ligado a esa consulta (1:1).
   * Devuelve la consulta guardada con el customer.
   */
  async persistConsultation(params: PersistConsultationParams) {
    const {
      companyId,
      userId,
      provider,
      meta,
      customer: customerData,
      risk,
      rawResponse,
      httpStatus,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      const customer = await this.upsertCustomer(tx, params, customerData);

      const consultation = await tx.creditBureauConsultation.create({
        data: {
          companyId,
          customerId: customer.id,
          createdBy: userId,
          provider,
          personType: meta.personType,
          consultaAt: meta.consultaAt,
          tipoIdDigitado: meta.tipoIdDigitado ?? '',
          numeroIdDigitado:
            meta.numeroIdDigitado ?? customerData.identificationNumber,
          txCode: meta.txCode,
          codigosRespuesta: toJson(meta.codigosRespuesta),
          codigosRespuestaLabeled: toJson(meta.codigosRespuestaLabeled),
          httpStatus,
          rawResponse: toJson(rawResponse),
        },
      });

      if (risk) {
        await tx.customerRiskSnapshot.create({
          data: {
            consultationId: consultation.id,
            customerId: customer.id,
            score: risk.score,
            viabilidad: risk.viabilidad,
            viabilidadLabel: risk.viabilidadLabel,
            ratingRecaudos: risk.ratingRecaudos,
            ratingRecaudosLabel: risk.ratingRecaudosLabel,
            nivelRiesgo: risk.nivelRiesgo,
            nivelRiesgoLabel: risk.nivelRiesgoLabel,
            ratingSectorial: risk.ratingSectorial,
            ratingSectorialLabel: risk.ratingSectorialLabel,
            montoSugerido: risk.montoSugerido,
            saldoActual: risk.saldoActual,
            porcentajeDeuda: risk.porcentajeDeuda,
            saldoMora: risk.saldoMora,
            hasAlertas: risk.hasAlertas,
            reportedIncome: risk.reportedIncome,
            quotaToIncomePct: risk.quotaToIncomePct,
            creditPortfolio: toJson(risk.creditPortfolio),
            paymentBehavior: toJson(risk.paymentBehavior),
            creditSectors: toJson(risk.creditSectors),
            linkNetwork: toJson(risk.linkNetwork),
            suggestions: toJson(risk.suggestions),
            alerts: toJson(risk.alerts),
          },
        });
      }

      return { consultation, customer };
    });
  }

  private async upsertCustomer(
    tx: Prisma.TransactionClient,
    params: PersistConsultationParams,
    data: MappedCustomer,
  ) {
    const { companyId, userId, personTypeId, identificationTypeId } = params;

    // Emails: solo se escriben si el Customer no los tiene (no pisar ediciones).
    const existing = await tx.customer.findUnique({
      where: {
        companyId_identificationNumber: {
          companyId,
          identificationNumber: data.identificationNumber,
        },
      },
      select: { email: true, legalRepEmail: true },
    });
    const emailPatch =
      !existing?.email && params.contactEmail
        ? { email: params.contactEmail }
        : {};
    const legalRepEmailPatch =
      !existing?.legalRepEmail && params.legalRepEmailFallback
        ? { legalRepEmail: params.legalRepEmailFallback }
        : {};

    // Campos que refrescamos con lo que trae la central (el último estado
    // conocido). No pisamos la identidad ni el createdBy en el update.
    const refreshable = {
      businessName: data.businessName,
      verificationDigit: data.verificationDigit,
      firstName: data.firstName,
      secondName: data.secondName,
      firstLastName: data.firstLastName,
      secondLastName: data.secondLastName,
      birthDate: data.birthDate,
      birthCity: data.birthCity,
      gender: data.gender,
      ageRange: data.ageRange,
      documentStatus: data.documentStatus,
      bureauProfile: toJson(data.bureauProfile),
      personTypeId,
      identificationTypeId,
      lastConsultedAt: params.meta.consultaAt,
    };

    return tx.customer.upsert({
      where: {
        companyId_identificationNumber: {
          companyId,
          identificationNumber: data.identificationNumber,
        },
      },
      create: {
        companyId,
        identificationNumber: data.identificationNumber,
        bureauCreated: true,
        createdBy: userId,
        updatedBy: userId,
        email: params.contactEmail,
        phone: params.contactSeed.phone,
        bureauCity: params.contactSeed.city,
        address: params.contactSeed.address,
        economicActivityId: params.contactSeed.economicActivityId,
        legalRepName: params.legalRepSeed?.name ?? null,
        legalRepIdentificationTypeId:
          params.legalRepSeed?.identificationTypeId ?? null,
        legalRepIdentificationNumber:
          params.legalRepSeed?.identificationNumber ?? null,
        legalRepEmail: params.legalRepEmailFallback,
        ...refreshable,
      },
      update: {
        updatedBy: userId,
        ...refreshable,
        ...emailPatch,
        ...legalRepEmailPatch,
      },
    });
  }

  /**
   * Backfill del email de contacto para un Customer que quedó sin él (p.ej.
   * creado antes de este campo o servido desde caché). Solo escribe si está
   * null; devuelve true si esta llamada lo escribió.
   */
  async setCustomerEmailIfMissing(
    customerId: string,
    email: string,
  ): Promise<boolean> {
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, email: null },
      data: { email },
    });
    return result.count > 0;
  }

  /**
   * Backfill del correo del representante legal (PJ): solo escribe si está
   * null; true si esta llamada lo escribió. El llamador garantiza PJ.
   */
  async setCustomerLegalRepEmailIfMissing(
    customerId: string,
    email: string,
  ): Promise<boolean> {
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, legalRepEmail: null },
      data: { legalRepEmail: email },
    });
    return result.count > 0;
  }

  /**
   * Busca el cliente por (companyId, identificación) para decidir si ya existe
   * antes de consultar la central. Trae su última consulta (con el risk snapshot)
   * para evaluar la vigencia de la caché sin queries extra.
   */
  async findCustomerWithLastConsultation(
    companyId: string,
    identificationNumber: string,
  ) {
    return this.prisma.customer.findUnique({
      where: {
        companyId_identificationNumber: { companyId, identificationNumber },
      },
      include: {
        daneCity: {
          select: { name: true, region: { select: { name: true } } },
        },
        bureauConsultations: {
          orderBy: { consultaAt: 'desc' },
          take: 1,
          include: { riskSnapshot: true },
        },
      },
    });
  }
}
