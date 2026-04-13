import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Req,
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
import type { Request } from 'express';
import { NotificationsService } from './notifications.service.js';
import { FilterNotificationDto } from './dto/filter-notification.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('companies/:companyId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications of a company for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of notifications with read status',
  })
  findAll(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() filters: FilterNotificationDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.notificationsService.findAll(companyId, userId, filters);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Unread notification count' })
  getUnreadCount(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.notificationsService.getUnreadCount(companyId, userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read for the authenticated user' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  markAllAsRead(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.notificationsService.markAllAsRead(companyId, userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found in this company' })
  markAsRead(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.notificationsService.markAsRead(id, companyId, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiResponse({ status: 204, description: 'Notification deleted successfully' })
  @ApiResponse({ status: 404, description: 'Notification not found in this company' })
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.remove(id, companyId);
  }
}
