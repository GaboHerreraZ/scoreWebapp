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

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

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
        { identificationNumber: { contains: filters.search, mode: 'insensitive' } },
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
}
