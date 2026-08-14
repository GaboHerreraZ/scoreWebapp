import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
import { LocationsRepository } from './locations.repository.js';

@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [LocationsController],
  providers: [LocationsService, LocationsRepository],
  exports: [LocationsService],
})
export class LocationsModule {}
