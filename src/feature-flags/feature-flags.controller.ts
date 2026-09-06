import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { FeatureFlagsService } from './feature-flags.service.js';

@ApiTags('Feature Flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  // Público: la landing (sin sesión) esconde con esto el producto apagado. Con
  // auth el 401 se tragaba y todo flag caía en false → la UI nunca aparecía.
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Flags activos. El front esconde UI con esto; el API autoriza.',
  })
  getFlags() {
    return this.featureFlagsService.getPublicFlags();
  }
}
