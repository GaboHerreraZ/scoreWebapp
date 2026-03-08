import { PartialType } from '@nestjs/swagger';
import { CreateCampaignDto } from './create-campaign.dto.js';

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}
