import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [PrismaModule, ParametersModule, MailModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
