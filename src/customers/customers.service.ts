import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { ParametersRepository } from '../parameters/parameters.repository.js';
import { FilterCustomerDto } from './dto/filter-customer.dto.js';
import { AutocompleteCustomerDto } from './dto/autocomplete-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { CustomerDetailResponseDto } from './dto/customer-detail-response.dto.js';
import { CustomerStatsResponseDto } from './dto/customer-stats-response.dto.js';
import { LegalRepresentativeResponseDto } from './dto/legal-representative-response.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ExcelService } from '../common/excel/excel.service.js';
import type { ExcelColumn } from '../common/excel/excel.types.js';

// El alta manual (create) se retiró: el Customer nace de una consulta al
// bureau. El update edita SOLO los campos que el refresh no pisa.
interface CustomerExportRow {
  businessName: string;
  identificationType: string | null;
  identificationNumber: string;
  personType: string | null;
  economicActivity: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Forma exacta que devuelve repository.findById (entidad + relaciones incluidas).
type CustomerWithRelations = Prisma.CustomerGetPayload<{
  include: {
    personType: true;
    company: true;
    economicActivity: true;
    identificationType: true;
    legalRepIdentificationType: true;
    daneCity: { select: { name: true; region: { select: { name: true } } } };
  };
}>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly parametersRepository: ParametersRepository,
    private readonly excelService: ExcelService,
  ) {}

  async findAll(companyId: string, filters: FilterCustomerDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = { companyId };

    if (filters.personTypeId) {
      where.personTypeId = filters.personTypeId;
    }

    if (filters.search) {
      where.OR = [
        { businessName: { contains: filters.search, mode: 'insensitive' } },
        {
          identificationNumber: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { businessName: 'asc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(
    id: string,
    companyId: string,
  ): Promise<CustomerDetailResponseDto> {
    const customer = await this.repository.findById(id, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Cliente con id=${id} no encontrado en esta empresa`,
      );
    }
    return this.toDetailResponse(customer);
  }

  async update(
    id: string,
    companyId: string,
    userId: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerDetailResponseDto> {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) {
      throw new NotFoundException(
        `Cliente con id=${id} no encontrado en esta empresa`,
      );
    }

    if (dto.economicActivityId != null) {
      const sector = await this.parametersRepository.findById(
        dto.economicActivityId,
      );
      if (!sector || sector.type !== 'sector' || !sector.isActive) {
        throw new BadRequestException(
          `economicActivityId=${dto.economicActivityId} no es una actividad económica válida (Parameter tipo 'sector' activo)`,
        );
      }
    }

    if (dto.legalRepIdentificationTypeId != null) {
      const identType = await this.parametersRepository.findById(
        dto.legalRepIdentificationTypeId,
      );
      if (
        !identType ||
        identType.type !== 'identification_type' ||
        !identType.isActive
      ) {
        throw new BadRequestException(
          `legalRepIdentificationTypeId=${dto.legalRepIdentificationTypeId} no es un tipo de identificación válido (Parameter tipo 'identification_type' activo)`,
        );
      }
    }

    // undefined → Prisma lo ignora; null → limpia el campo.
    const updated = await this.repository.update(id, {
      email: dto.email,
      phone: dto.phone,
      cityCode: dto.cityCode,
      address: dto.address,
      economicActivityId: dto.economicActivityId,
      legalRepName: dto.legalRepName,
      legalRepIdentificationTypeId: dto.legalRepIdentificationTypeId,
      legalRepIdentificationNumber: dto.legalRepIdentificationNumber,
      legalRepEmail: dto.legalRepEmail,
      legalRepPhone: dto.legalRepPhone,
      updatedBy: userId,
    });

    return this.toDetailResponse(updated);
  }

  // Aplana la entidad Prisma (nombres, demográficos y verificationDigit sueltos en
  // la raíz) a la forma anidada del DTO unificado. Los bloques que no aplican al
  // tipo de persona quedan null: nameParts + demographics solo para PN;
  // verificationDigit + bureauProfile solo para PJ.
  private toDetailResponse(
    c: CustomerWithRelations,
  ): CustomerDetailResponseDto {
    const hasNameParts =
      c.firstName != null ||
      c.secondName != null ||
      c.firstLastName != null ||
      c.secondLastName != null;

    const hasDemographics =
      c.birthDate != null ||
      c.birthCity != null ||
      c.gender != null ||
      c.ageRange != null ||
      c.documentStatus != null;

    // Rep. legal de las columnas editables (no el de bureauProfile).
    const hasLegalRep =
      c.legalRepName != null ||
      c.legalRepIdentificationTypeId != null ||
      c.legalRepIdentificationNumber != null ||
      c.legalRepEmail != null ||
      c.legalRepPhone != null;

    return {
      id: c.id,
      companyId: c.companyId,
      personType: {
        id: c.personType.id,
        code: c.personType.code,
        label: c.personType.label,
      },
      identificationType: c.identificationType
        ? {
            id: c.identificationType.id,
            code: c.identificationType.code,
            label: c.identificationType.label,
          }
        : null,
      businessName: c.businessName,
      identificationNumber: c.identificationNumber,
      verificationDigit: c.verificationDigit,
      economicActivity: c.economicActivity
        ? {
            id: c.economicActivity.id,
            code: c.economicActivity.code,
            label: c.economicActivity.label,
          }
        : null,
      nameParts: hasNameParts
        ? {
            firstName: c.firstName,
            secondName: c.secondName,
            firstLastName: c.firstLastName,
            secondLastName: c.secondLastName,
          }
        : null,
      email: c.email,
      phone: c.phone,
      cityCode: c.cityCode,
      city: c.daneCity?.name ?? c.bureauCity,
      state: c.daneCity?.region.name ?? null,
      address: c.address,
      legalRep: hasLegalRep
        ? {
            name: c.legalRepName,
            identificationType: c.legalRepIdentificationType
              ? {
                  id: c.legalRepIdentificationType.id,
                  code: c.legalRepIdentificationType.code,
                  label: c.legalRepIdentificationType.label,
                }
              : null,
            identificationNumber: c.legalRepIdentificationNumber,
            email: c.legalRepEmail,
            phone: c.legalRepPhone,
          }
        : null,
      demographics: hasDemographics
        ? {
            birthDate: c.birthDate,
            birthCity: c.birthCity,
            gender: c.gender,
            ageRange: c.ageRange,
            documentStatus: c.documentStatus,
          }
        : null,
      bureauProfile:
        (c.bureauProfile as CustomerDetailResponseDto['bureauProfile']) ?? null,
      bureauCreated: c.bureauCreated,
      lastConsultedAt: c.lastConsultedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  // Quien firma por el cliente: PJ → columnas legalRep*; PN → su propia identidad.
  async getLegalRepresentative(
    id: string,
    companyId: string,
  ): Promise<LegalRepresentativeResponseDto> {
    const customer = await this.repository.findById(id, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Cliente con id=${id} no encontrado en esta empresa`,
      );
    }

    const base = {
      customerId: customer.id,
      personType: {
        id: customer.personType.id,
        code: customer.personType.code,
        label: customer.personType.label,
      },
    };

    if (customer.personType.code === 'legalEntity') {
      return {
        ...base,
        legalRepName: customer.legalRepName,
        legalRepIdentificationTypeId: customer.legalRepIdentificationTypeId,
        legalRepIdentificationNumber: customer.legalRepIdentificationNumber,
        legalRepEmail: customer.legalRepEmail,
        legalRepPhone: customer.legalRepPhone,
      };
    }

    return {
      ...base,
      identificationTypeId: customer.identificationTypeId,
      identificationNumber: customer.identificationNumber,
      firstName: customer.firstName,
      secondName: customer.secondName,
      firstLastName: customer.firstLastName,
      secondLastName: customer.secondLastName,
      email: customer.email,
      phone: customer.phone,
    };
  }

  async findCreditStudies(customerId: string, companyId: string) {
    const customer = await this.repository.findById(customerId, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Cliente con id=${customerId} no encontrado en esta empresa`,
      );
    }

    return this.repository.findCreditStudiesByCustomerId({
      customerId,
      companyId,
      orderBy: { studyDate: 'desc' },
    });
  }

  // Estadísticas de vistazo rápido: comportamiento crediticio del cliente en la
  // empresa, calculado sobre sus CreditStudy. Un solo query; los agregados se
  // computan en memoria (un cliente tiene decenas de estudios, no miles).
  async getStats(
    customerId: string,
    companyId: string,
  ): Promise<CustomerStatsResponseDto> {
    const customer = await this.repository.findById(customerId, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Cliente con id=${customerId} no encontrado en esta empresa`,
      );
    }

    // Más reciente primero: los cálculos de "último" toman el índice 0.
    const studies = await this.repository.findCreditStudiesByCustomerId({
      customerId,
      companyId,
      orderBy: { studyDate: 'desc' },
    });

    const now = new Date();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const avg = (values: number[]) =>
      values.length
        ? round1(values.reduce((a, b) => a + b, 0) / values.length)
        : null;

    // ── studies ──
    const first = studies.at(-1) ?? null;
    const last = studies.at(0) ?? null;

    const byStatusMap = new Map<string, { label: string; count: number }>();
    for (const s of studies) {
      const entry = byStatusMap.get(s.status.code);
      if (entry) {
        entry.count++;
      } else {
        byStatusMap.set(s.status.code, { label: s.status.label, count: 1 });
      }
    }

    // ── viability (solo estudios ya analizados) ──
    const analyzed = studies.filter((s) => s.viabilityStatus != null);
    const countBy = (status: string) =>
      analyzed.filter((s) => s.viabilityStatus === status).length;
    const approved = countBy('approved');
    const scores = analyzed
      .map((s) => s.viabilityScore)
      .filter((v): v is number => v != null);
    const lastAnalyzed = analyzed.at(0) ?? null;
    const prevAnalyzed = analyzed.at(1) ?? null;

    let scoreTrend: 'up' | 'down' | 'stable' | null = null;
    if (
      lastAnalyzed?.viabilityScore != null &&
      prevAnalyzed?.viabilityScore != null
    ) {
      const delta = lastAnalyzed.viabilityScore - prevAnalyzed.viabilityScore;
      scoreTrend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'stable';
    }

    // ── amounts ──
    const requested = studies
      .map((s) => s.requestedCreditLine)
      .filter((v): v is number => v != null);
    const recommended = studies
      .map((s) => s.recommendedCreditLine)
      .filter((v): v is number => v != null);
    const totalRequested = requested.length
      ? requested.reduce((a, b) => a + b, 0)
      : null;
    const totalRecommended = recommended.length
      ? recommended.reduce((a, b) => a + b, 0)
      : null;
    const lastWithRecommendation =
      studies.find((s) => s.recommendedCreditLine != null) ?? null;

    // ── timing ──
    const resolutionDays = studies
      .filter((s) => s.resolutionDate != null)
      .map(
        (s) =>
          (s.resolutionDate!.getTime() - s.studyDate.getTime()) / MS_PER_DAY,
      )
      .filter((d) => d >= 0);
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    return {
      customerId,
      studies: {
        total: studies.length,
        firstStudyDate: first?.studyDate ?? null,
        lastStudyDate: last?.studyDate ?? null,
        daysSinceLastStudy: last
          ? Math.floor((now.getTime() - last.studyDate.getTime()) / MS_PER_DAY)
          : null,
        byStatus: [...byStatusMap.entries()].map(([code, v]) => ({
          code,
          label: v.label,
          count: v.count,
        })),
      },
      viability: {
        analyzed: analyzed.length,
        approved,
        conditional: countBy('conditional'),
        rejected: countBy('rejected'),
        approvalRate: analyzed.length
          ? round1((approved / analyzed.length) * 100)
          : null,
        avgScore: avg(scores),
        lastScore: lastAnalyzed?.viabilityScore ?? null,
        lastStatus: lastAnalyzed?.viabilityStatus ?? null,
        scoreTrend,
      },
      amounts: {
        totalRequested,
        avgRequested: avg(requested),
        totalRecommended,
        avgRecommended: avg(recommended),
        recommendationRatio:
          totalRequested && totalRecommended != null
            ? round1((totalRecommended / totalRequested) * 100)
            : null,
        lastRecommendedCreditLine:
          lastWithRecommendation?.recommendedCreditLine ?? null,
      },
      timing: {
        avgResolutionDays: avg(resolutionDays),
        studiesLast12Months: studies.filter(
          (s) => s.studyDate >= twelveMonthsAgo,
        ).length,
      },
    };
  }

  async autocomplete(companyId: string, filters: AutocompleteCustomerDto) {
    return this.repository.autocomplete(companyId, filters.search);
  }

  async exportToExcel(companyId: string) {
    const customers = await this.repository.findAllForExport(companyId);

    const rows: CustomerExportRow[] = customers.map((c) => ({
      businessName: c.businessName,
      identificationType: c.identificationType?.label ?? null,
      identificationNumber: c.identificationNumber,
      personType: c.personType?.label ?? null,
      economicActivity: c.economicActivity?.label ?? null,
      email: c.email,
      phone: c.phone,
      city: c.daneCity?.name ?? c.bureauCity,
      state: c.daneCity?.region.name ?? null,
      address: c.address,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    const columns: ExcelColumn<CustomerExportRow>[] = [
      {
        header: 'Razón social',
        key: 'businessName',
        type: 'string',
        width: 35,
      },
      {
        header: 'Tipo identificación',
        key: 'identificationType',
        type: 'string',
        width: 22,
      },
      {
        header: 'Identificación',
        key: 'identificationNumber',
        type: 'string',
        width: 20,
      },
      { header: 'Tipo persona', key: 'personType', type: 'string', width: 18 },
      {
        header: 'Actividad económica',
        key: 'economicActivity',
        type: 'string',
        width: 30,
      },
      { header: 'Email', key: 'email', type: 'string', width: 28 },
      { header: 'Teléfono', key: 'phone', type: 'string', width: 18 },
      { header: 'Ciudad', key: 'city', type: 'string', width: 20 },
      { header: 'Departamento', key: 'state', type: 'string', width: 20 },
      { header: 'Dirección', key: 'address', type: 'string', width: 30 },
      { header: 'Creado', key: 'createdAt', type: 'datetime', width: 20 },
      { header: 'Actualizado', key: 'updatedAt', type: 'datetime', width: 20 },
    ];

    const timestamp = new Date().toISOString().slice(0, 10);

    return this.excelService.generate({
      fileName: `clientes-${timestamp}`,
      sheets: [
        {
          name: 'Clientes',
          columns,
          data: rows,
        },
      ],
    });
  }
}
