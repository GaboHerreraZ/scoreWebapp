import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { PurgeCompanyDto } from './dto/purge-company.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Borrado TOTAL de una empresa y de todo su rastro. Existe solo en STAGING
 * (StagingOnlyGuard en el controller): es irreversible y cross-tenant.
 *
 * El schema no tiene ni un `onDelete: Cascade` — todas las FKs son Restrict —
 * así que el orden de abajo NO es cosmético: es el único orden en el que
 * Postgres acepta los DELETE. Va todo en una transacción: o cae toda la
 * empresa o no cae nada.
 *
 * Fuera de alcance a propósito: catálogos globales (parameters, ofertas,
 * precios, planes de comisión, vendedores, ítems de facturación), los leads de
 * contact_requests (no tienen FK a la empresa, solo el nombre en texto), los
 * usuarios de Supabase Auth, los archivos en Storage y los documentos que viven
 * en terceros (Zapsign, ePayco, Aliaddo/DIAN).
 */

/** Nombre de tabla + filas borradas, en el orden real de ejecución. */
export interface PurgeStep {
  table: string;
  rows: number;
}

/** Tiempo de la transacción: una empresa con años de datos no cabe en 5s. */
const PURGE_TIMEOUT_MS = 120_000;
const PURGE_MAX_WAIT_MS = 15_000;

@Injectable()
export class CompanyPurgeService {
  private readonly logger = new Logger(CompanyPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  /**
   * Inventario en seco: qué se borraría y qué usuarios caen o se conservan.
   * No modifica nada; es lo que el portal muestra antes de pedir el NIT.
   */
  async preview(companyId: string) {
    const company = await this.findCompanyOrFail(companyId);
    const users = await this.classifyUsers(this.prisma, companyId);
    const steps = await this.countRows(companyId, users.toDelete.length);

    return {
      company: {
        id: company.id,
        name: company.name,
        nit: company.nit,
        isActive: company.isActive,
        createdAt: company.createdAt,
      },
      steps,
      totalRows: steps.reduce((sum, step) => sum + step.rows, 0),
      users: {
        members: users.memberIds.length,
        profilesToDelete: users.toDelete.length,
        profilesKept: users.kept,
      },
    };
  }

  /**
   * Ejecuta el borrado. callerUserId es el usuario de Supabase del portal:
   * solo el rol 'admin' puede hacerlo (soporte y ventas, no).
   */
  async purge(
    companyId: string,
    dto: PurgeCompanyDto,
    callerUserId: string,
  ): Promise<{
    company: { id: string; name: string; nit: string };
    steps: PurgeStep[];
    totalRows: number;
    users: {
      removedFromCompany: number;
      profilesDeleted: number;
      profilesKept: Array<{
        id: string;
        email: string;
        otherCompanies: number;
      }>;
    };
    durationMs: number;
  }> {
    await this.assertCallerIsAdmin(callerUserId);

    const company = await this.findCompanyOrFail(companyId);
    if (dto.confirmNit.trim() !== company.nit) {
      throw new BadRequestException(
        'El NIT de confirmación no coincide con el de la empresa',
      );
    }

    const startedAt = Date.now();
    this.logger.warn(
      `PURGA de empresa ${company.name} (${company.nit}, id=${companyId}) solicitada por ${callerUserId}`,
    );

    const result = await this.prisma.$transaction(
      async (tx) => this.deleteAll(tx, companyId),
      { timeout: PURGE_TIMEOUT_MS, maxWait: PURGE_MAX_WAIT_MS },
    );

    const durationMs = Date.now() - startedAt;
    this.logger.warn(
      `PURGA completada: ${company.nit} — ${result.totalRows} filas en ${durationMs} ms`,
    );

    return {
      company: { id: company.id, name: company.name, nit: company.nit },
      ...result,
      durationMs,
    };
  }

  // ── Ejecución ──────────────────────────────────────────────────────────

  /**
   * El barrido completo, en el orden que exigen las FKs. Cada bloque depende
   * del anterior: mover una línea de sitio rompe el borrado.
   */
  private async deleteAll(tx: Prisma.TransactionClient, companyId: string) {
    const steps: PurgeStep[] = [];
    const push = (table: string, result: { count: number }) =>
      steps.push({ table, rows: result.count });

    // Códigos promocionales GLOBALES que usó la empresa: al borrar sus canjes
    // hay que devolverles el cupo (redemptionsCount es un denormalizado).
    const usedPromoCodes = await tx.promoCodeRedemption.findMany({
      where: { companyId },
      select: { promoCodeId: true },
      distinct: ['promoCodeId'],
    });

    // ── Fase A: bolsas, pagos y comisiones ──
    push(
      'notification_reads',
      await tx.notificationRead.deleteMany({
        where: { notification: { companyId } },
      }),
    );
    push(
      'credit_study_resets',
      await tx.creditStudyReset.deleteMany({ where: { companyId } }),
    );
    push(
      'sales_commissions',
      await tx.salesCommission.deleteMany({ where: { companyId } }),
    );
    push(
      'promo_code_redemptions',
      await tx.promoCodeRedemption.deleteMany({ where: { companyId } }),
    );
    push(
      'electronic_invoices',
      await tx.electronicInvoice.deleteMany({ where: { companyId } }),
    );
    // companyId es nullable (el webhook no siempre identifica la empresa): se
    // barre también por la bolsa a la que apuntan.
    push(
      'payment_events',
      await tx.paymentEvent.deleteMany({
        where: { OR: [{ companyId }, { analysisPack: { companyId } }] },
      }),
    );
    push(
      'payment_alerts',
      await tx.paymentAlert.deleteMany({ where: { companyId } }),
    );
    push(
      'analysis_consumptions',
      await tx.analysisConsumption.deleteMany({ where: { companyId } }),
    );
    push(
      'analysis_packs',
      await tx.analysisPack.deleteMany({ where: { companyId } }),
    );
    push(
      'company_referrals',
      await tx.companyReferral.deleteMany({ where: { companyId } }),
    );
    push(
      'promo_codes',
      await tx.promoCode.deleteMany({ where: { companyId } }),
    );

    // Cupo devuelto a los códigos que sobreviven (los globales).
    for (const { promoCodeId } of usedPromoCodes) {
      const remaining = await tx.promoCodeRedemption.count({
        where: { promoCodeId },
      });
      await tx.promoCode.updateMany({
        where: { id: promoCodeId },
        data: { redemptionsCount: remaining },
      });
    }

    // ── Fase B: estudios de crédito ──
    push(
      'support_tickets',
      await tx.supportTicket.deleteMany({ where: { companyId } }),
    );
    push(
      'credit_study_financial_analyses',
      await tx.creditStudyFinancialAnalysis.deleteMany({
        where: { creditStudy: { companyId } },
      }),
    );
    push(
      'promissory_notes',
      await tx.promissoryNote.deleteMany({ where: { companyId } }),
    );
    push(
      'ai_analyses',
      await tx.aiAnalysis.deleteMany({ where: { companyId } }),
    );
    push(
      'credit_studies',
      await tx.creditStudy.deleteMany({ where: { companyId } }),
    );
    push(
      'scoring_configuration_weights',
      await tx.scoringConfigurationWeight.deleteMany({
        where: { config: { companyId } },
      }),
    );
    push(
      'scoring_configurations',
      await tx.scoringConfiguration.deleteMany({ where: { companyId } }),
    );

    // ── Fase C: clientes, financieros y central de riesgo ──
    push(
      'financial_statement_periods',
      await tx.financialStatementPeriod.deleteMany({ where: { companyId } }),
    );
    push(
      'financial_analyses',
      await tx.financialAnalysis.deleteMany({ where: { companyId } }),
    );
    push(
      'customer_risk_snapshots',
      await tx.customerRiskSnapshot.deleteMany({
        where: { customer: { companyId } },
      }),
    );
    push(
      'credit_bureau_consultations',
      await tx.creditBureauConsultation.deleteMany({ where: { companyId } }),
    );
    push(
      'customer_authorizations',
      await tx.customerAuthorization.deleteMany({ where: { companyId } }),
    );
    push('customers', await tx.customer.deleteMany({ where: { companyId } }));

    // ── Fase D: empresa y usuarios ──
    push(
      'einvoice_contact_refs',
      await tx.eInvoiceContactRef.deleteMany({ where: { companyId } }),
    );
    push(
      'notifications',
      await tx.notification.deleteMany({ where: { companyId } }),
    );
    push(
      'invitations',
      await tx.invitation.deleteMany({ where: { companyId } }),
    );

    const users = await this.classifyUsers(tx, companyId);
    push(
      'user_companies',
      await tx.userCompany.deleteMany({ where: { companyId } }),
    );
    // Solo los usuarios DE esta empresa: quien también pertenece a otra
    // conserva su perfil (ya quedó fuera de esta al borrar user_companies).
    push(
      'profiles',
      await tx.profile.deleteMany({ where: { id: { in: users.toDelete } } }),
    );

    await tx.company.delete({ where: { id: companyId } });
    steps.push({ table: 'companies', rows: 1 });

    return {
      steps,
      totalRows: steps.reduce((sum, step) => sum + step.rows, 0),
      users: {
        removedFromCompany: users.memberIds.length,
        profilesDeleted: users.toDelete.length,
        profilesKept: users.kept,
      },
    };
  }

  // ── Apoyo ──────────────────────────────────────────────────────────────

  private async findCompanyOrFail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        nit: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }
    return company;
  }

  private async assertCallerIsAdmin(callerUserId: string) {
    const caller =
      await this.platformAdminRepository.findByUserIdWithRole(callerUserId);
    if (!caller || !caller.isActive || caller.role?.code !== 'admin') {
      throw new ForbiddenException(
        'Solo un administrador puede eliminar una empresa',
      );
    }
  }

  /**
   * Miembros de la empresa separados en los que se borran (no pertenecen a
   * ninguna otra) y los que se conservan, con cuántas empresas les quedan.
   */
  private async classifyUsers(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
  ) {
    const members = await client.userCompany.findMany({
      where: { companyId },
      select: { user: { select: { id: true, email: true } } },
    });
    const memberIds = members.map((m) => m.user.id);
    if (memberIds.length === 0) {
      return { memberIds, toDelete: [] as string[], kept: [] };
    }

    const otherMemberships = await client.userCompany.groupBy({
      by: ['userId'],
      where: { userId: { in: memberIds }, companyId: { not: companyId } },
      _count: { _all: true },
    });
    const otherByUser = new Map(
      otherMemberships.map((m) => [m.userId, m._count._all]),
    );

    const toDelete = memberIds.filter((id) => !otherByUser.has(id));
    const kept = members
      .filter((m) => otherByUser.has(m.user.id))
      .map((m) => ({
        id: m.user.id,
        email: m.user.email,
        otherCompanies: otherByUser.get(m.user.id) ?? 0,
      }));

    return { memberIds, toDelete, kept };
  }

  /** Mismos filtros que el borrado, en count: lo que verá el preview. */
  private async countRows(
    companyId: string,
    profilesToDelete: number,
  ): Promise<PurgeStep[]> {
    const p = this.prisma;
    const entries: Array<[string, Promise<number>]> = [
      [
        'notification_reads',
        p.notificationRead.count({ where: { notification: { companyId } } }),
      ],
      [
        'credit_study_resets',
        p.creditStudyReset.count({ where: { companyId } }),
      ],
      ['sales_commissions', p.salesCommission.count({ where: { companyId } })],
      [
        'promo_code_redemptions',
        p.promoCodeRedemption.count({ where: { companyId } }),
      ],
      [
        'electronic_invoices',
        p.electronicInvoice.count({ where: { companyId } }),
      ],
      [
        'payment_events',
        p.paymentEvent.count({
          where: { OR: [{ companyId }, { analysisPack: { companyId } }] },
        }),
      ],
      ['payment_alerts', p.paymentAlert.count({ where: { companyId } })],
      [
        'analysis_consumptions',
        p.analysisConsumption.count({ where: { companyId } }),
      ],
      ['analysis_packs', p.analysisPack.count({ where: { companyId } })],
      ['company_referrals', p.companyReferral.count({ where: { companyId } })],
      ['promo_codes', p.promoCode.count({ where: { companyId } })],
      ['support_tickets', p.supportTicket.count({ where: { companyId } })],
      [
        'credit_study_financial_analyses',
        p.creditStudyFinancialAnalysis.count({
          where: { creditStudy: { companyId } },
        }),
      ],
      ['promissory_notes', p.promissoryNote.count({ where: { companyId } })],
      ['ai_analyses', p.aiAnalysis.count({ where: { companyId } })],
      ['credit_studies', p.creditStudy.count({ where: { companyId } })],
      [
        'scoring_configuration_weights',
        p.scoringConfigurationWeight.count({
          where: { config: { companyId } },
        }),
      ],
      [
        'scoring_configurations',
        p.scoringConfiguration.count({ where: { companyId } }),
      ],
      [
        'financial_statement_periods',
        p.financialStatementPeriod.count({ where: { companyId } }),
      ],
      [
        'financial_analyses',
        p.financialAnalysis.count({ where: { companyId } }),
      ],
      [
        'customer_risk_snapshots',
        p.customerRiskSnapshot.count({ where: { customer: { companyId } } }),
      ],
      [
        'credit_bureau_consultations',
        p.creditBureauConsultation.count({ where: { companyId } }),
      ],
      [
        'customer_authorizations',
        p.customerAuthorization.count({ where: { companyId } }),
      ],
      ['customers', p.customer.count({ where: { companyId } })],
      [
        'einvoice_contact_refs',
        p.eInvoiceContactRef.count({ where: { companyId } }),
      ],
      ['notifications', p.notification.count({ where: { companyId } })],
      ['invitations', p.invitation.count({ where: { companyId } })],
      ['user_companies', p.userCompany.count({ where: { companyId } })],
    ];

    const rows = await Promise.all(entries.map(([, count]) => count));
    const steps = entries.map((entry, i) => ({
      table: entry[0],
      rows: rows[i],
    }));

    // profiles sale de la clasificación de usuarios, no de un count.
    steps.push({ table: 'profiles', rows: profilesToDelete });
    steps.push({ table: 'companies', rows: 1 });

    return steps;
  }
}
