import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ProfilesService } from './profiles.service.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { FilterProfileDto } from './dto/filter-profile.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';

@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a profile' })
  @ApiResponse({ status: 201, description: 'Profile created successfully' })
  @ApiResponse({ status: 409, description: 'Profile with that email already exists' })
  create(@Body() dto: CreateProfileDto) {
    return this.profilesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List profiles with pagination and search' })
  @ApiResponse({ status: 200, description: 'Paginated list of profiles' })
  findAll(@Query() filters: FilterProfileDto) {
    return this.profilesService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a profile by ID' })
  @ApiResponse({ status: 200, description: 'Profile found', type: ProfileResponseDto })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.findById(id);
  }

  @Get(':id/companies')
  @ApiOperation({ summary: 'List companies associated with a profile' })
  @ApiResponse({ status: 200, description: 'Paginated list of profile companies (with role and sector)' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  findCompanies(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaginationDto,
  ) {
    return this.profilesService.findCompanies(id, filters);
  }

  @Get(':id/invited-users')
  @ApiOperation({ summary: 'List users invited by this profile' })
  @ApiResponse({ status: 200, description: 'Paginated list of invited users (with company and user data)' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  findInvitedUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaginationDto,
  ) {
    return this.profilesService.findInvitedUsers(id, filters);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profilesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a profile' })
  @ApiResponse({ status: 204, description: 'Profile deleted successfully' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete: has dependencies' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.remove(id);
  }
}
