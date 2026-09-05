import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service.js';

@ApiTags('Feature Flags')
@ApiBearerAuth()
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Flags activos. El front esconde UI con esto; el API autoriza.',
  })
  getFlags() {
    return this.featureFlagsService.getPublicFlags();
  }
}
