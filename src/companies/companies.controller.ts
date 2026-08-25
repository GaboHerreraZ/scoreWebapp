import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CompaniesService } from './companies.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { FilterCompanyDto } from './dto/filter-company.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { MAX_IMAGE_UPLOAD_BYTES } from '../common/constants/upload-limits.js';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { CompanyScoped } from '../common/decorators/company-scoped.decorator.js';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List companies with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of companies' })
  findAll(@Query() filters: FilterCompanyDto) {
    return this.companiesService.findAll(filters);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get companies by user ID (self or admin)' })
  @ApiResponse({ status: 200, description: 'List of companies for this user' })
  async findByUserId(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).user.id as string;
    if (requesterId !== userId) {
      const isAdmin =
        await this.platformAdminRepository.isPlatformAdmin(requesterId);
      if (!isAdmin) {
        throw new ForbiddenException(
          'Solo puedes consultar tus propias empresas',
        );
      }
    }
    return this.companiesService.findByUserId(userId);
  }

  @Get(':companyId')
  @CompanyScoped()
  @ApiOperation({ summary: 'Get a company by ID' })
  @ApiResponse({ status: 200, description: 'Company found' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  findById(@Param('companyId', ParseUUIDPipe) id: string) {
    return this.companiesService.findById(id);
  }

  @Get(':companyId/customers')
  @CompanyScoped()
  @ApiOperation({ summary: 'List customers of a company' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of company customers',
  })
  @ApiResponse({ status: 404, description: 'Company not found' })
  findCustomers(
    @Param('companyId', ParseUUIDPipe) id: string,
    @Query() filters: PaginationDto,
  ) {
    return this.companiesService.findCustomers(id, filters);
  }

  @Patch(':companyId')
  @CompanyScoped()
  @ApiOperation({ summary: 'Partially update a company' })
  @ApiResponse({ status: 200, description: 'Company updated successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({
    status: 409,
    description: 'NIT uniqueness conflict or NIT already set',
  })
  update(
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(id, dto);
  }

  @Patch(':companyId/logo')
  @CompanyScoped()
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }),
  )
  @ApiOperation({ summary: 'Upload or update company logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        logo: {
          type: 'string',
          format: 'binary',
          description: 'Image file (PNG, JPG, WEBP) max 2MB',
        },
      },
      required: ['logo'],
    },
  })
  @ApiResponse({ status: 200, description: 'Logo updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  uploadLogo(
    @Param('companyId', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo de logo es requerido');
    }

    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de archivo inválido. Permitidos: PNG, JPG, WEBP',
      );
    }

    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        'El tamaño del archivo no debe exceder 2MB',
      );
    }

    return this.companiesService.uploadLogo(id, file);
  }

  @Delete(':companyId')
  @CompanyScoped()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a company' })
  @ApiResponse({ status: 204, description: 'Company deleted successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has dependencies' })
  remove(@Param('companyId', ParseUUIDPipe) id: string) {
    return this.companiesService.remove(id);
  }
}
