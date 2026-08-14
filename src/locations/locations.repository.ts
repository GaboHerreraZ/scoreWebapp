import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRegions() {
    return this.prisma.daneRegion.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    });
  }

  async findRegionByCode(code: string) {
    return this.prisma.daneRegion.findUnique({
      where: { code },
      select: { code: true, name: true },
    });
  }

  async findCitiesByRegion(regionCode: string) {
    return this.prisma.daneCity.findMany({
      where: { regionCode, isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    });
  }
}
