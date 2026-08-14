import { Injectable, NotFoundException } from '@nestjs/common';
import { LocationsRepository } from './locations.repository.js';

@Injectable()
export class LocationsService {
  constructor(private readonly repository: LocationsRepository) {}

  findRegions() {
    return this.repository.findRegions();
  }

  async findCitiesByRegion(regionCode: string) {
    const region = await this.repository.findRegionByCode(regionCode);
    if (!region) {
      throw new NotFoundException(
        `Departamento con código ${regionCode} no encontrado`,
      );
    }
    return this.repository.findCitiesByRegion(regionCode);
  }
}
