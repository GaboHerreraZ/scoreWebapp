import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ParametersService } from './parameters.service.js';
import { CreateParameterDto } from './dto/create-parameter.dto.js';
import { UpdateParameterDto } from './dto/update-parameter.dto.js';
import { FilterParameterDto } from './dto/filter-parameter.dto.js';

@ApiTags('Parameters')
@ApiBearerAuth()
@Controller('parameters')
export class ParametersController {
  constructor(private readonly parametersService: ParametersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a parameter' })
  @ApiResponse({ status: 201, description: 'Parameter created successfully' })
  @ApiResponse({
    status: 409,
    description: 'Parameter with that type and code already exists',
  })
  create(@Body() dto: CreateParameterDto) {
    return this.parametersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List parameters' })
  @ApiResponse({ status: 200, description: 'list of parameters' })
  findAll(@Query() filters: FilterParameterDto) {
    return this.parametersService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a parameter by ID' })
  @ApiResponse({ status: 200, description: 'Parameter found' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.parametersService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a parameter' })
  @ApiResponse({ status: 200, description: 'Parameter updated successfully' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  @ApiResponse({ status: 409, description: 'Type+code uniqueness conflict' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateParameterDto,
  ) {
    return this.parametersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a parameter' })
  @ApiResponse({ status: 204, description: 'Parameter deleted successfully' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has dependencies' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.parametersService.remove(id);
  }
}
