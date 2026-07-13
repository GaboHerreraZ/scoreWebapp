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
    const { companyId, userId, provider, meta, customer: customerData, risk, rawResponse, httpStatus } =
      params;

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
            creditPortfolio: toJson(risk.creditPortfolio),
            paymentBehavior: toJson(risk.paymentBehavior),
            creditSectors: toJson(risk.creditSectors),
            linkNetwork: toJson(risk.linkNetwork),
          },
        });
      }

      return { consultation, customer };
    });
  }

  private upsertCustomer(
    tx: Prisma.TransactionClient,
    params: PersistConsultationParams,
    data: MappedCustomer,
  ) {
    const { companyId, userId, personTypeId, identificationTypeId } = params;

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
        ...refreshable,
      },
      update: {
        updatedBy: userId,
        ...refreshable,
      },
    });
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
        bureauConsultations: {
          orderBy: { consultaAt: 'desc' },
          take: 1,
          include: { riskSnapshot: true },
        },
      },
    });
  }
}
