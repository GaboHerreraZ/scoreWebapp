import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupportTicketsRepository } from './support-tickets.repository.js';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto.js';
import { FilterSupportTicketDto } from './dto/filter-support-ticket.dto.js';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { MailService } from '../mail/mail.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { toJson } from '../common/utils/prisma-json.util.js';

@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name);

  constructor(
    private readonly repository: SupportTicketsRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Crea un ticket de soporte de una empresa. Resuelve los Parameter (area/type/
   * priority + estado inicial 'open'), genera el reference atómico y dispara los
   * correos (confirmación al cliente + aviso a admins, best-effort). companyId
   * viene de la ruta; createdBy del token (Profile = id de Supabase).
   */
  async create(companyId: string, dto: CreateSupportTicketDto, userId: string) {
    const [area, type, priority, openStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode('support_area', dto.area),
      this.repository.findParameterByTypeAndCode('support_type', dto.type),
      this.repository.findParameterByTypeAndCode(
        'support_priority',
        dto.priority,
      ),
      this.repository.findParameterByTypeAndCode('support_status', 'open'),
    ]);
    if (!area || !type || !priority || !openStatus) {
      throw new BadRequestException(
        'Faltan parámetros de soporte (area/type/priority/status)',
      );
    }

    // Vínculo por FK tipada según el área: credit_study exige el estudio (y
    // deriva su cliente); customer exige el cliente; payment/account/other no
    // llevan id extra (companyId ya ata el ticket al tenant). Todo id que
    // venga se valida: debe existir y pertenecer a ESTA empresa.
    if (dto.area === 'credit_study' && !dto.creditStudyId) {
      throw new BadRequestException(
        'El área credit_study requiere creditStudyId (el estudio del problema)',
      );
    }
    if (dto.area === 'customer' && !dto.customerId) {
      throw new BadRequestException(
        'El área customer requiere customerId (el cliente del problema)',
      );
    }

    let creditStudyId: string | null = null;
    let customerId: string | null = null;
    if (dto.creditStudyId) {
      const study = await this.repository.findCreditStudy(
        dto.creditStudyId,
        companyId,
      );
      if (!study) {
        throw new BadRequestException(
          'creditStudyId no corresponde a un estudio de esta empresa',
        );
      }
      creditStudyId = study.id;
      customerId = study.customerId; // el ticket queda atado a ambos
    }
    if (dto.customerId) {
      const customer = await this.repository.findCustomer(
        dto.customerId,
        companyId,
      );
      if (!customer) {
        throw new BadRequestException(
          'customerId no corresponde a un cliente de esta empresa',
        );
      }
      if (customerId && customerId !== customer.id) {
        throw new BadRequestException(
          'customerId no coincide con el cliente del estudio enviado',
        );
      }
      customerId = customer.id;
    }

    const year = new Date().getFullYear();
    const ticket = await this.repository.createWithReference(
      {
        companyId,
        areaId: area.id,
        typeId: type.id,
        priorityId: priority.id,
        statusId: openStatus.id,
        subject: dto.subject,
        description: dto.description,
        creditStudyId,
        customerId,
        context: toJson(dto.context),
        createdBy: userId,
      },
      year,
    );

    // Correos best-effort (no bloquean ni revierten la creación del ticket).
    void this.notify(ticket, area.label);

    // Lo que el front muestra en el toast.
    return {
      id: ticket.id,
      reference: ticket.reference,
      status: ticket.status.code,
      createdAt: ticket.createdAt,
    };
  }

  private async notify(
    ticket: Awaited<
      ReturnType<SupportTicketsRepository['createWithReference']>
    >,
    areaLabel: string,
  ) {
    // Confirmación al cliente (autor del ticket).
    try {
      const to = ticket.createdByUser?.email;
      if (to) {
        const name =
          [ticket.createdByUser?.name, ticket.createdByUser?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'cliente';
        await this.mailService.sendSupportTicketClientEmail({
          to,
          fullName: name,
          reference: ticket.reference,
          subject: ticket.subject,
          areaLabel,
        });
      }
    } catch (e) {
      this.logger.error(
        `Ticket ${ticket.reference}: fallo al confirmar al cliente: ${
          (e as Error).message
        }`,
      );
    }

    // Aviso a los admins activos del portal.
    try {
      const adminEmails =
        await this.platformAdminRepository.findActiveAdminEmails();
      await Promise.all(
        adminEmails.map((to) =>
          this.mailService.sendSupportTicketAdminEmail({
            to,
            reference: ticket.reference,
            companyName: ticket.company.name,
            areaLabel,
            subject: ticket.subject,
            description: ticket.description,
          }),
        ),
      );
    } catch (e) {
      this.logger.error(
        `Ticket ${ticket.reference}: fallo al avisar a los admins: ${
          (e as Error).message
        }`,
      );
    }
  }

  // ── Vista del cliente ─────────────────────────────────────────────────

  /** Tickets de una empresa (historial del cliente), paginado. */
  async findByCompany(companyId: string, filters: FilterSupportTicketDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters, { companyId });
    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return this.paginate(data, total, page, limit);
  }

  // ── Panel admin ───────────────────────────────────────────────────────

  async findAll(filters: FilterSupportTicketDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters);
    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return this.paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const ticket = await this.repository.findById(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket con id=${id} no encontrado`);
    }
    return ticket;
  }

  /**
   * Gestiona un ticket (admin): estado, asignación y/o notas. Los datos del
   * cliente son inmutables. assignedTo es el id de un PlatformAdmin; cuando la
   * asignación CAMBIA a un admin, se le avisa por correo (best-effort) que el
   * ticket quedó a su nombre y le toca revisarlo y dar soporte.
   */
  async update(id: string, dto: UpdateSupportTicketDto) {
    const current = await this.findOne(id);

    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;

    // Asignación: el destino debe ser un admin del portal ACTIVO (evita FKs
    // rotas y correos a cuentas desactivadas). null = desasignar.
    let assignedAdmin: { email: string; name: string | null } | null = null;
    if (dto.assignedTo !== undefined) {
      if (dto.assignedTo !== null) {
        const admin = await this.platformAdminRepository.findById(
          dto.assignedTo,
        );
        if (!admin || !admin.isActive) {
          throw new BadRequestException(
            'assignedTo no corresponde a un admin del portal activo',
          );
        }
        assignedAdmin = { email: admin.email, name: admin.name };
      }
      data.assignedTo = dto.assignedTo;
    }

    if (dto.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'support_status',
        dto.status,
      );
      if (!status) {
        throw new BadRequestException(`Estado inválido: ${dto.status}`);
      }
      data.statusId = status.id;
    }

    const updated = await this.repository.update(id, data);

    // Correo SOLO cuando la asignación cambia (no en re-guardados del mismo
    // admin ni en updates de solo notas/estado). Best-effort: no bloquea.
    if (assignedAdmin && dto.assignedTo !== current.assignedTo) {
      void this.notifyAssigned(updated, assignedAdmin);
    }

    return updated;
  }

  /** Correo al admin recién asignado con el resumen del ticket. */
  private async notifyAssigned(
    ticket: Awaited<ReturnType<SupportTicketsRepository['update']>>,
    admin: { email: string; name: string | null },
  ) {
    try {
      await this.mailService.sendSupportTicketAssignedEmail({
        to: admin.email,
        adminName: admin.name ?? 'equipo Creditia',
        reference: ticket.reference,
        companyName: ticket.company.name,
        areaLabel: ticket.area.label,
        priorityLabel: ticket.priority.label,
        subject: ticket.subject,
        description: ticket.description,
      });
    } catch (e) {
      this.logger.error(
        `Ticket ${ticket.reference}: fallo al avisar al admin asignado: ${
          (e as Error).message
        }`,
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async buildWhere(
    filters: FilterSupportTicketDto,
    base: Prisma.SupportTicketWhereInput = {},
  ): Promise<Prisma.SupportTicketWhereInput> {
    const where: Prisma.SupportTicketWhereInput = { ...base };

    if (filters.status) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_status',
        filters.status,
      );
      where.statusId = p?.id ?? -1;
    }
    if (filters.area) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_area',
        filters.area,
      );
      where.areaId = p?.id ?? -1;
    }
    if (filters.type) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_type',
        filters.type,
      );
      where.typeId = p?.id ?? -1;
    }
    if (filters.priority) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_priority',
        filters.priority,
      );
      where.priorityId = p?.id ?? -1;
    }
    if (filters.search) {
      where.OR = [
        { reference: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private paginate<T>(data: T[], total: number, page: number, limit: number) {
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
