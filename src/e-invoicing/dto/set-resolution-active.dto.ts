import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetResolutionActiveDto {
  @ApiProperty({
    description:
      'true la pone vigente (y retira las demás del mismo ambiente); false la retira.',
  })
  @IsBoolean()
  isActive: boolean;
}
