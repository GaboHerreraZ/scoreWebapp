// Corta la cadena repository → PrismaService → cliente generado (que Jest no
// parsea): aquí solo se testea el service con un repo de mentiras.
jest.mock('./feature-flags.repository.js', () => ({
  FeatureFlagsRepository: class {},
}));

import { NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service.js';
import type { FeatureFlagsRepository } from './feature-flags.repository.js';

const repoMock = (rows: Array<{ code: string; enabled: boolean }>) => {
  const findAll = jest.fn().mockResolvedValue(rows);
  const setEnabled = jest
    .fn()
    .mockImplementation((code: string, enabled: boolean) =>
      Promise.resolve({ code, enabled }),
    );
  const repo = {
    findAll,
    findAllWithAdmin: jest.fn(),
    setEnabled,
  } as unknown as FeatureFlagsRepository;
  return { repo, findAll, setEnabled };
};

describe('FeatureFlagsService', () => {
  it('lee de BD una sola vez dentro del TTL (caché)', async () => {
    const { repo, findAll } = repoMock([
      { code: 'paymentCapacity', enabled: true },
    ]);
    const service = new FeatureFlagsService(repo);

    await expect(service.isEnabled('paymentCapacity')).resolves.toBe(true);
    await service.isEnabled('paymentCapacity');
    await service.getPublicFlags();

    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it('flag sin fila → false: lo seguro es apagado', async () => {
    const service = new FeatureFlagsService(repoMock([]).repo);
    await expect(service.isEnabled('paymentCapacity')).resolves.toBe(false);
    await expect(service.getPublicFlags()).resolves.toEqual({
      paymentCapacity: false,
    });
  });

  it('el toggle invalida el caché de inmediato', async () => {
    const { repo, findAll, setEnabled } = repoMock([
      { code: 'paymentCapacity', enabled: true },
    ]);
    const service = new FeatureFlagsService(repo);

    await service.isEnabled('paymentCapacity');
    await service.setEnabled('paymentCapacity', false, null);
    await service.isEnabled('paymentCapacity');

    expect(findAll).toHaveBeenCalledTimes(2);
    expect(setEnabled).toHaveBeenCalledWith('paymentCapacity', false, null);
  });

  it('rechaza codes fuera del catálogo', async () => {
    const service = new FeatureFlagsService(repoMock([]).repo);
    await expect(
      service.setEnabled('flagInventado', true, null),
    ).rejects.toThrow(NotFoundException);
  });
});
