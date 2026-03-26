import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AiAnalysesService } from './ai-analyses.service.js';
import { FilterAiAnalysisDto } from './dto/filter-ai-analysis.dto.js';

@ApiTags('AI Analyses')
@ApiBearerAuth()
@Controller('companies/:companyId/ai-analyses')
export class AiAnalysesController {
  constructor(private readonly aiAnalysesService: AiAnalysesService) {}

  @Post('credit-studies/:creditStudyId')
  @ApiOperation({ summary: 'Run AI analysis on a credit study' })
  @ApiResponse({
    status: 201,
    description: 'AI analysis completed and saved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Study not performed, subscription limit reached, or AI call failed',
  })
  @ApiResponse({
    status: 404,
    description: 'Credit study not found in this company',
  })
  analyze(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('creditStudyId', ParseUUIDPipe) creditStudyId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.aiAnalysesService.analyze(creditStudyId, companyId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List AI analyses for a company' })
  @ApiResponse({ status: 200, description: 'Paginated list of AI analyses' })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterAiAnalysisDto,
  ) {
    return this.aiAnalysesService.findAll(companyId, filters);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get AI analysis usage for the current month' })
  @ApiResponse({ status: 200, description: 'Current month AI usage stats' })
  getUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.aiAnalysesService.getUsage(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an AI analysis by ID' })
  @ApiResponse({ status: 200, description: 'AI analysis found' })
  @ApiResponse({
    status: 404,
    description: 'AI analysis not found in this company',
  })
  findById(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiAnalysesService.findById(id, companyId);
  }
}
