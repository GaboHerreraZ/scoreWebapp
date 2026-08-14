import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LocationsService } from './locations.service.js';
import { Public } from '../common/decorators/public.decorator.js';

/** El catálogo DIVIPOLA cambia muy rara vez: 24 h de caché en memoria. */
const CATALOG_TTL = 24 * 60 * 60 * 1000;

/**
 * Catálogo geográfico oficial (DIVIPOLA). Read-only y @Public: son datos
 * públicos y los alimenta el formulario de facturación, el onboarding, la ficha
 * de cliente y el estudio de crédito — antes venían de api-colombia.com.
 */
@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Public()
  @Get('regions')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(CATALOG_TTL)
  @ApiOperation({ summary: 'Lista los departamentos (código DANE + nombre)' })
  @ApiResponse({
    status: 200,
    description: 'Departamentos ordenados por nombre',
  })
  findRegions() {
    return this.locationsService.findRegions();
  }

  @Public()
  @Get('regions/:regionCode/cities')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(CATALOG_TTL)
  @ApiOperation({ summary: 'Lista los municipios de un departamento' })
  @ApiResponse({ status: 200, description: 'Municipios ordenados por nombre' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findCitiesByRegion(@Param('regionCode') regionCode: string) {
    return this.locationsService.findCitiesByRegion(regionCode);
  }
}
