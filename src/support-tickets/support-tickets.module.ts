import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SupportTicketsService } from './support-tickets.service.js';
import { SupportTicketsRepository } from './support-tickets.repository.js';
import { SupportTicketsController } from './support-tickets.controller.js';
import { CompanySupportTicketsController } from './company-support-tickets.controller.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [CompanySupportTicketsController, SupportTicketsController],
  providers: [SupportTicketsService, SupportTicketsRepository],
})
export class SupportTicketsModule {}
