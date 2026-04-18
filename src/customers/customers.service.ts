import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { FilterCustomerDto } from './dto/filter-customer.dto.js';
import { AutocompleteCustomerDto } from './dto/autocomplete-customer.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ExcelService } from '../common/excel/excel.service.js';
import type { ExcelColumn } from '../common/excel/excel.types.js';

interface CustomerExportRow {
  businessName: string;
  identificationType: string | null;
  identificationNumber: string;
  personType: string | null;
  economicActivity: string | null;
  legalRepName: string | null;
  legalRepIdentificationType: string | null;
  legalRepId: string | null;
  legalRepEmail: string | null;
  legalRepPhone: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  seniority: number | null;
  commercialRef1Name: string | null;
  commercialRef1Contact: string | null;
  commercialRef1Phone: string | null;
  commercialRef2Name: string | null;
  commercialRef2Contact: string | null;
  commercialRef2Phone: string | null;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly excelService: ExcelService,
  ) {}

  async create(companyId: string, userId: string, dto: CreateCustomerDto) {
    const existing = await this.repository.findByIdentification(
      dto.identificationNumber,
      companyId,
    );
    if (existing) {
      throw new ConflictException(
        `Customer with identification "${dto.identificationNumber}" already exists in this company`,
      );
    }

    return this.repository.create({
      companyId,
      personTypeId: dto.personTypeId,
      identificationTypeId: dto.identificationTypeId,
      businessName: dto.businessName,
      identificationNumber: dto.identificationNumber,
      legalRepName: dto.legalRepName,
      legalRepId: dto.legalRepId,
      economicActivityId: dto.economicActivityId,
      email: dto.email,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone,
      city: dto.city,
      address: dto.address,
      seniority: dto.seniority,
      commercialRef1Name: dto.commercialRef1Name,
      commercialRef1Contact: dto.commercialRef1Contact,
      commercialRef1Phone: dto.commercialRef1Phone,
      commercialRef2Name: dto.commercialRef2Name,
      commercialRef2Contact: dto.commercialRef2Contact,
      commercialRef2Phone: dto.commercialRef2Phone,
      observations: dto.observations,
      createdBy: userId,
      updatedBy: userId,
    });
  }

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

  async findById(id: string, companyId: string) {
    const customer = await this.repository.findById(id, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Customer with id=${id} not found in this company`,
      );
    }
    return customer;
  }

  async update(
    id: string,
    companyId: string,
    userId: string,
    dto: UpdateCustomerDto,
  ) {
    const current = await this.repository.findById(id, companyId);
    if (!current) {
      throw new NotFoundException(
        `Customer with id=${id} not found in this company`,
      );
    }

    if (
      dto.identificationNumber &&
      dto.identificationNumber !== current.identificationNumber
    ) {
      const duplicate = await this.repository.findByIdentification(
        dto.identificationNumber,
        companyId,
      );
      if (duplicate) {
        throw new ConflictException(
          `Customer with identification "${dto.identificationNumber}" already exists in this company`,
        );
      }
    }

    return this.repository.update(id, {
      ...dto,
      updatedBy: userId,
    });
  }

  async remove(id: string, companyId: string) {
    const customer = await this.repository.findById(id, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Customer with id=${id} not found in this company`,
      );
    }

    const hasStudies = await this.repository.hasCreditStudies(id);
    if (hasStudies) {
      throw new ConflictException(
        'Cannot delete: this customer has associated credit studies',
      );
    }

    return this.repository.delete(id);
  }

  async findCreditStudies(customerId: string, companyId: string) {
    const customer = await this.repository.findById(customerId, companyId);
    if (!customer) {
      throw new NotFoundException(
        `Customer with id=${customerId} not found in this company`,
      );
    }

    return this.repository.findCreditStudiesByCustomerId({
      customerId,
      companyId,
      orderBy: { studyDate: 'desc' },
    });
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
      legalRepName: c.legalRepName,
      legalRepIdentificationType: c.legalRepIdentificationType?.label ?? null,
      legalRepId: c.legalRepId,
      legalRepEmail: c.legalRepEmail,
      legalRepPhone: c.legalRepPhone,
      email: c.email,
      phone: c.phone,
      secondaryPhone: c.secondaryPhone,
      city: c.city,
      state: c.state,
      address: c.address,
      seniority: c.seniority,
      commercialRef1Name: c.commercialRef1Name,
      commercialRef1Contact: c.commercialRef1Contact,
      commercialRef1Phone: c.commercialRef1Phone,
      commercialRef2Name: c.commercialRef2Name,
      commercialRef2Contact: c.commercialRef2Contact,
      commercialRef2Phone: c.commercialRef2Phone,
      observations: c.observations,
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
      {
        header: 'Representante legal',
        key: 'legalRepName',
        type: 'string',
        width: 30,
      },
      {
        header: 'Tipo id. rep. legal',
        key: 'legalRepIdentificationType',
        type: 'string',
        width: 22,
      },
      {
        header: 'Identificación rep. legal',
        key: 'legalRepId',
        type: 'string',
        width: 22,
      },
      {
        header: 'Email rep. legal',
        key: 'legalRepEmail',
        type: 'string',
        width: 28,
      },
      {
        header: 'Teléfono rep. legal',
        key: 'legalRepPhone',
        type: 'string',
        width: 20,
      },
      { header: 'Email', key: 'email', type: 'string', width: 28 },
      { header: 'Teléfono', key: 'phone', type: 'string', width: 18 },
      {
        header: 'Teléfono secundario',
        key: 'secondaryPhone',
        type: 'string',
        width: 20,
      },
      { header: 'Ciudad', key: 'city', type: 'string', width: 20 },
      { header: 'Departamento', key: 'state', type: 'string', width: 20 },
      { header: 'Dirección', key: 'address', type: 'string', width: 30 },
      {
        header: 'Antigüedad (años)',
        key: 'seniority',
        type: 'number',
        width: 15,
      },
      {
        header: 'Ref. comercial 1 - Nombre',
        key: 'commercialRef1Name',
        type: 'string',
        width: 28,
      },
      {
        header: 'Ref. comercial 1 - Contacto',
        key: 'commercialRef1Contact',
        type: 'string',
        width: 28,
      },
      {
        header: 'Ref. comercial 1 - Teléfono',
        key: 'commercialRef1Phone',
        type: 'string',
        width: 22,
      },
      {
        header: 'Ref. comercial 2 - Nombre',
        key: 'commercialRef2Name',
        type: 'string',
        width: 28,
      },
      {
        header: 'Ref. comercial 2 - Contacto',
        key: 'commercialRef2Contact',
        type: 'string',
        width: 28,
      },
      {
        header: 'Ref. comercial 2 - Teléfono',
        key: 'commercialRef2Phone',
        type: 'string',
        width: 22,
      },
      {
        header: 'Observaciones',
        key: 'observations',
        type: 'string',
        width: 40,
      },
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
