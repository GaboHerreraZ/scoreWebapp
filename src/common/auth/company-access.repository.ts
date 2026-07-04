import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class CompanyAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** True si el usuario es miembro ACTIVO de la empresa (user_companies). */
  async isActiveMember(userId: string, companyId: string): Promise<boolean> {
    const membership = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { isActive: true },
    });
    return !!membership && membership.isActive;
  }

  /**
   * True si la empresa firmó su contrato macro. Estado DERIVADO del
   * ContractSignature (uno-a-uno por companyId único): no hay flag duplicado en
   * Company, la fuente de verdad es signedAt. Un join barato por índice único.
   */
  async hasSignedContract(companyId: string): Promise<boolean> {
    const contract = await this.prisma.contractSignature.findUnique({
      where: { companyId },
      select: { signedAt: true },
    });
    return !!contract?.signedAt;
  }
}
