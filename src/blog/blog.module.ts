import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BlogService } from './blog.service.js';
import { BlogRepository } from './blog.repository.js';
import { BlogPublicController } from './blog-public.controller.js';
import { BlogAdminController } from './blog-admin.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [BlogPublicController, BlogAdminController],
  providers: [BlogService, BlogRepository],
})
export class BlogModule {}
