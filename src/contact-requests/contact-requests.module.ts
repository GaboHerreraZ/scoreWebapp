import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MailModule } from '../mail/mail.module.js';
import { ContactRequestsService } from './contact-requests.service.js';
import { ContactRequestsRepository } from './contact-requests.repository.js';
import { ContactRequestsController } from './contact-requests.controller.js';
import { ContactSalesController } from './contact-sales.controller.js';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [ContactSalesController, ContactRequestsController],
  providers: [ContactRequestsService, ContactRequestsRepository],
})
export class ContactRequestsModule {}
