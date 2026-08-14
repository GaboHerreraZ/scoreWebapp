import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CompaniesRepository } from './companies.repository.js';
import { SupabaseService } from '../auth/supabase.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { FilterCompanyDto } from './dto/filter-company.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FiscalProfileValidator } from '../e-invoicing/fiscal-profile.validator.js';

const LOGO_BUCKET = 'company-logos';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly supabaseService: SupabaseService,
    private readonly fiscalProfileValidator: FiscalProfileValidator,
  ) {}

  async findAll(filters: FilterCompanyDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CompanyWhereInput = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { nit: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where,
      orderBy: { name: 'asc' },
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

  async findById(id: string) {
    const company = await this.repository.findByIdWithDetails(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    let logoSignedUrl: string | null = null;
    if (company.logoUrl) {
      logoSignedUrl = await this.supabaseService.createSignedUrl(
        LOGO_BUCKET,
        company.logoUrl,
      );
    }

    return { ...company, logoSignedUrl };
  }

  async findByUserId(userId: string) {
    const companies = await this.repository.findByUserId(userId);

    return Promise.all(
      companies.map(async (company) => {
        let logoSignedUrl: string | null = null;
        if (company.logoUrl) {
          logoSignedUrl = await this.supabaseService.createSignedUrl(
            LOGO_BUCKET,
            company.logoUrl,
          );
        }
        return { ...company, logoSignedUrl };
      }),
    );
  }

  async update(id: string, dto: UpdateCompanyDto) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    if (dto.nit && dto.nit !== current.nit) {
      const duplicate = await this.repository.findByNit(dto.nit);
      if (duplicate) {
        throw new ConflictException(
          `Ya existe una empresa con NIT "${dto.nit}"`,
        );
      }
    }

    // Perfil fiscal: los parámetros enviados deben existir y ser del tipo
    // correcto (undefined = no se toca).
    await this.fiscalProfileValidator.validateSelection({
      billingRegimeTypeId: dto.billingRegimeTypeId,
      billingFiscalResponsibilities: dto.billingFiscalResponsibilities,
    });

    return this.repository.update(id, {
      name: dto.name,
      nit: dto.nit,
      sectorId: dto.sectorId,
      cityCode: dto.cityCode,
      address: dto.address,
      accountTypeId: dto.accountTypeId,
      accountBankId: dto.accountBankId,
      accountNumber: dto.accountNumber,
      billingName: dto.billingName,
      billingLastName: dto.billingLastName,
      billingBusinessName: dto.billingBusinessName,
      billingDocTypeId: dto.billingDocTypeId,
      billingDocNumber: dto.billingDocNumber,
      billingEmail: dto.billingEmail,
      billingAddress: dto.billingAddress,
      billingCityCode: dto.billingCityCode,
      billingRegimeTypeId: dto.billingRegimeTypeId,
      billingFiscalResponsibilities: dto.billingFiscalResponsibilities,
      billingPhone: dto.billingPhone,
      isActive: dto.isActive,
    });
  }

  async uploadLogo(id: string, file: Express.Multer.File) {
    const company = await this.repository.findById(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    const ext = file.originalname.split('.').pop() ?? 'png';
    const storagePath = `${id}/logo.${ext}`;

    await this.supabaseService.uploadFile(
      LOGO_BUCKET,
      storagePath,
      file.buffer,
      file.mimetype,
    );

    await this.repository.updateLogoUrl(id, storagePath);

    const logoSignedUrl = await this.supabaseService.createSignedUrl(
      LOGO_BUCKET,
      storagePath,
    );

    return { logoUrl: storagePath, logoSignedUrl };
  }

  async remove(id: string) {
    const company = await this.repository.findById(id);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${id} no encontrada`);
    }

    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictException(
        'No se puede eliminar: la empresa tiene registros asociados',
      );
    }

    return this.repository.delete(id);
  }

  async findCustomers(companyId: string, filters: PaginationDto) {
    const company = await this.repository.findById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};

    if (filters.search) {
      where.OR = [
        { businessName: { contains: filters.search, mode: 'insensitive' } },
        {
          identificationNumber: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const { data, total } = await this.repository.findCustomersByCompanyId({
      companyId,
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
}
