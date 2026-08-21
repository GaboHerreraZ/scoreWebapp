import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SalesRepository } from './sales.repository.js';
import { CreateSalesRepDto } from './dto/create-sales-rep.dto.js';
import { UpdateSalesRepDto } from './dto/update-sales-rep.dto.js';
import { CreateCommissionPlanDto } from './dto/create-commission-plan.dto.js';
import { AssignReferralDto } from './dto/assign-referral.dto.js';
import { SalesCommissionsService } from './sales-commissions.service.js';
import {
  REFERRAL_ASSIGNMENT_WINDOW_DAYS,
  referralWindowExpiresAt,
  type SalesCaller,
} from './sales.types.js';
import { Prisma } from '../../generated/prisma/client.js';

export type { SalesCaller };

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly repository: SalesRepository,
    private readonly commissionsService: SalesCommissionsService,
  ) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Resuelve quién llama a partir del userId de Supabase. El AdminGuard ya
   * garantizó que es un PlatformAdmin activo; aquí se distingue su alcance.
   */
  async resolveCaller(userId: string): Promise<SalesCaller> {
    const admin = await this.repository.findPlatformAdminByUserId(userId);
    if (!admin || !admin.isActive) {
      throw new ForbiddenException('No tienes acceso al portal');
    }
    return {
      platformAdminId: admin.id,
      name: admin.name,
      isAdmin: admin.role?.code === 'admin',
      salesRepId: admin.salesRep?.id ?? null,
    };
  }

  /** Gestionar el programa (vendedores, plan, vinculaciones) es solo de admin. */
  private assertIsAdmin(caller: SalesCaller) {
    if (!caller.isAdmin) {
      throw new ForbiddenException(
        'Solo un administrador puede gestionar el programa de vendedores',
      );
    }
  }

  // ── Plan de comisiones ────────────────────────────────────────────────

  /**
   * Plan vigente. Es la única fuente de los porcentajes al vincular una empresa;
   * si no hay ninguno configurado, el programa no puede operar.
   */
  async getActivePlan() {
    const plan = await this.repository.findActivePlan();
    if (!plan) {
      throw new NotFoundException(
        'No hay un plan de comisiones vigente. Configura uno antes de vincular empresas.',
      );
    }
    return plan;
  }

  async listPlans(caller: SalesCaller) {
    this.assertIsAdmin(caller);
    return this.repository.findPlans();
  }

  /** Publica una versión nueva del plan y desactiva la anterior. */
  async publishPlan(dto: CreateCommissionPlanDto, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const plan = await this.repository.publishPlan({
      name: dto.name,
      newCustomerPercent: new Prisma.Decimal(dto.newCustomerPercent),
      recurringPercent: new Prisma.Decimal(dto.recurringPercent),
      notes: dto.notes ?? null,
      createdBy: caller.platformAdminId,
    });

    this.logger.log(
      `Plan de comisiones "${plan.name}" publicado: ${dto.newCustomerPercent}% nuevo / ` +
        `${dto.recurringPercent}% recompra (por ${caller.name ?? caller.platformAdminId})`,
    );
    return plan;
  }

  // ── Vendedores ────────────────────────────────────────────────────────

  /**
   * Código sugerido a partir del nombre: sin tildes, solo A-Z0-9, máx. 20. Si ya
   * existe, agrega un sufijo numérico hasta encontrar uno libre.
   */
  private async generateCode(name: string | null): Promise<string> {
    const base =
      (name ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // marcas de acento sueltas tras NFD
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 20) || 'VENDEDOR';

    if (!(await this.repository.findRepByCode(base))) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}${i}`;
      if (!(await this.repository.findRepByCode(candidate))) return candidate;
    }
    throw new ConflictException(
      'No se pudo generar un código libre; asigna uno manualmente',
    );
  }

  async listReps(caller: SalesCaller, onlyActive = false) {
    this.assertIsAdmin(caller);
    return this.repository.findReps(onlyActive);
  }

  /**
   * Da de alta como vendedor a una cuenta del portal ya creada. El usuario se
   * crea antes en "Usuarios plataforma" con rol 'sales'; aquí solo se le asigna
   * su código y entra al programa.
   */
  async createRep(dto: CreateSalesRepDto, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const admin = await this.repository.findPlatformAdminById(
      dto.platformAdminId,
    );
    if (!admin) {
      throw new NotFoundException(
        `Usuario del portal con id=${dto.platformAdminId} no encontrado`,
      );
    }
    if (admin.role?.code !== 'sales') {
      throw new BadRequestException(
        `El usuario ${admin.email} no tiene rol de vendedor (rol actual: ${
          admin.role?.label ?? 'sin rol'
        })`,
      );
    }

    const existing = await this.repository.findRepByPlatformAdminId(admin.id);
    if (existing) {
      throw new ConflictException(
        `${admin.email} ya está registrado como vendedor con el código ${existing.code}`,
      );
    }

    const code = dto.code
      ? this.normalizeCode(dto.code)
      : await this.generateCode(admin.name);

    if (dto.code && (await this.repository.findRepByCode(code))) {
      throw new ConflictException(
        `Ya existe un vendedor con el código ${code}`,
      );
    }

    return this.repository.createRep({
      platformAdminId: admin.id,
      code,
      notes: dto.notes ?? null,
      isActive: true,
    });
  }

  async findRep(id: string, caller: SalesCaller) {
    const rep = await this.repository.findRepById(id);
    if (!rep) {
      throw new NotFoundException(`Vendedor con id=${id} no encontrado`);
    }
    // Un vendedor solo puede mirarse a sí mismo.
    if (!caller.isAdmin && caller.salesRepId !== rep.id) {
      throw new ForbiddenException('Solo puedes consultar tu propia ficha');
    }
    return rep;
  }

  async updateRep(id: string, dto: UpdateSalesRepDto, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const rep = await this.repository.findRepById(id);
    if (!rep) {
      throw new NotFoundException(`Vendedor con id=${id} no encontrado`);
    }

    const data: Prisma.SalesRepUncheckedUpdateInput = {};
    if (dto.code !== undefined) {
      const code = this.normalizeCode(dto.code);
      const clash = await this.repository.findRepByCode(code);
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `Ya existe un vendedor con el código ${code}`,
        );
      }
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.repository.updateRep(id, data);
  }

  /** Empresas que trajo un vendedor (su cartera). */
  async listRepReferrals(salesRepId: string, caller: SalesCaller) {
    if (!caller.isAdmin && caller.salesRepId !== salesRepId) {
      throw new ForbiddenException(
        'Solo puedes consultar tus propias empresas',
      );
    }
    return this.repository.findReferralsByRep(salesRepId);
  }

  // ── Vinculación empresa ↔ vendedor ────────────────────────────────────

  /**
   * Ventana para asignarle vendedor a una empresa desde el panel: los primeros
   * REFERRAL_ASSIGNMENT_WINDOW_DAYS días desde que la empresa se creó. Vencida,
   * la empresa queda como venta directa de forma definitiva.
   *
   * Es un corte deliberado: sin él, cualquier vendedor podría reclamar meses
   * después una empresa que no trajo, y no habría cómo demostrarlo.
   */
  private windowState(companyCreatedAt: Date) {
    const expiresAt = referralWindowExpiresAt(companyCreatedAt);
    const msLeft = expiresAt.getTime() - Date.now();
    return {
      windowDays: REFERRAL_ASSIGNMENT_WINDOW_DAYS,
      expiresAt,
      isOpen: msLeft > 0,
      // Hacia arriba: si quedan 2 horas, al usuario le queda "1 día".
      daysLeft: Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000))),
    };
  }

  private assertWindowOpen(companyCreatedAt: Date) {
    const window = this.windowState(companyCreatedAt);
    if (!window.isOpen) {
      throw new ConflictException(
        `El plazo de ${REFERRAL_ASSIGNMENT_WINDOW_DAYS} días para asignarle vendedor a esta empresa ` +
          `venció el ${window.expiresAt.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}.`,
      );
    }
  }

  /**
   * Vendedor de una empresa + estado de la ventana de asignación (lo necesita el
   * panel para mostrar u ocultar el botón y avisar cuántos días quedan).
   */
  async getCompanyReferral(companyId: string, caller: SalesCaller) {
    const referral = await this.repository.findReferralByCompany(companyId);
    if (
      referral &&
      !caller.isAdmin &&
      caller.salesRepId !== referral.salesRepId
    ) {
      throw new ForbiddenException('Esta empresa no está en tu cartera');
    }

    const company = await this.repository.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }

    return {
      referral, // null = empresa sin vendedor (venta directa)
      window: this.windowState(company.createdAt),
    };
  }

  /**
   * Resuelve el código que el cliente escribió en su propio registro. Devuelve
   * los datos para crear la vinculación dentro de la transacción del onboarding
   * (no la crea aquí: la empresa todavía no existe).
   *
   * Lanza si el código no sirve, para que el cliente lo corrija en el formulario
   * en vez de creer que le dio crédito a alguien que nunca lo recibió.
   */
  async resolveCodeForOnboarding(rawCode: string) {
    const code = this.normalizeCode(rawCode);
    const rep = await this.repository.findRepByCode(code);
    if (!rep || !rep.isActive) {
      throw new BadRequestException(
        `El código de vendedor "${code}" no existe o ya no está activo. Verifícalo o déjalo vacío.`,
      );
    }

    const plan = await this.getActivePlan();
    return {
      salesRepId: rep.id,
      code: rep.code,
      commissionPlanId: plan.id,
      newCustomerPercent: plan.newCustomerPercent,
      recurringPercent: plan.recurringPercent,
    };
  }

  /**
   * Vincula la empresa al vendedor del código dado. Congela los % del plan
   * vigente: la empresa conserva las condiciones con las que se cerró aunque
   * después cambie el plan global.
   *
   * Solo dentro de la VENTANA de asignación (ver assertWindowOpen). Al vincular
   * se liquidan las compras que la empresa ya pagó y aún no comisionaron, para
   * que olvidar el código en el registro no le cueste al vendedor el 30% de la
   * primera venta.
   *
   * Reasignar dentro de la ventana es posible (corregir una digitación), pero NO
   * recalcula las comisiones ya causadas: esas quedan a nombre de quien las ganó.
   */
  async assignReferral(
    companyId: string,
    dto: AssignReferralDto,
    caller: SalesCaller,
  ) {
    this.assertIsAdmin(caller);

    const company = await this.repository.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException(`Empresa con id=${companyId} no encontrada`);
    }
    this.assertWindowOpen(company.createdAt);

    const code = this.normalizeCode(dto.code);
    const rep = await this.repository.findRepByCode(code);
    if (!rep) {
      throw new NotFoundException(
        `No existe un vendedor con el código ${code}`,
      );
    }
    if (!rep.isActive) {
      throw new BadRequestException(
        `El vendedor ${code} está inactivo en el programa`,
      );
    }

    const plan = await this.getActivePlan();

    const referral = await this.repository.upsertReferral({
      companyId,
      salesRepId: rep.id,
      commissionPlanId: plan.id,
      newCustomerPercent: plan.newCustomerPercent,
      recurringPercent: plan.recurringPercent,
      assignedBy: caller.platformAdminId,
      notes: dto.notes ?? null,
    });

    // Compras ya pagadas que estaban sin comisionar (el caso "se le olvidó el
    // código al registrarse"): se causan ahora, cada una en su mes real.
    const backlog =
      await this.commissionsService.accrueBacklogForCompany(companyId);

    this.logger.log(
      `Empresa ${company.name} (${company.nit}) vinculada al vendedor ${code} ` +
        `— ${plan.newCustomerPercent.toString()}% / ${plan.recurringPercent.toString()}%` +
        (backlog.count > 0
          ? `; se causaron ${backlog.count} comisión(es) retroactiva(s) por ${backlog.totalAmount}`
          : ''),
    );
    return { ...referral, backlog };
  }

  /**
   * Cuánto se causaría al vincular esta empresa, sin escribir nada. Lo usa el
   * panel para avisar antes de guardar.
   */
  async previewReferralBacklog(companyId: string, caller: SalesCaller) {
    this.assertIsAdmin(caller);
    const plan = await this.getActivePlan();
    return this.commissionsService.previewBacklog(
      companyId,
      Number(plan.newCustomerPercent),
      Number(plan.recurringPercent),
    );
  }

  /**
   * Desvincula una empresa. Solo si aún no causó comisiones: si ya las hay, el
   * histórico dejaría de cuadrar — en ese caso se reasigna, no se borra.
   */
  async removeReferral(companyId: string, caller: SalesCaller) {
    this.assertIsAdmin(caller);

    const referral = await this.repository.findReferralByCompany(companyId);
    if (!referral) {
      throw new NotFoundException('La empresa no tiene vendedor asignado');
    }

    const commissions =
      await this.repository.countCommissionsByCompany(companyId);
    if (commissions > 0) {
      throw new ConflictException(
        `La empresa ya causó ${commissions} comisión(es); reasigna el vendedor en vez de desvincularla`,
      );
    }

    await this.repository.deleteReferral(companyId);
    return { deleted: true };
  }
}
