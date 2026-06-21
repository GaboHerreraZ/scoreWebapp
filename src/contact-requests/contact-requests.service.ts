import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ContactRequestsRepository } from './contact-requests.repository.js';
import { CreateContactRequestDto } from './dto/create-contact-request.dto.js';
import { FilterContactRequestDto } from './dto/filter-contact-request.dto.js';
import { UpdateContactRequestDto } from './dto/update-contact-request.dto.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { MailService } from '../mail/mail.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ContactRequestsService {
  private readonly logger = new Logger(ContactRequestsService.name);

  constructor(
    private readonly repository: ContactRequestsRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Registra un lead del formulario público y notifica a los admins
   * (best-effort: el envío de correo no bloquea ni revierte el guardado).
   */
  async create(
    dto: CreateContactRequestDto,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    const [subject, newStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode('contact_subject', dto.subject),
      this.repository.findParameterByTypeAndCode('contact_status', 'new'),
    ]);
    if (!subject || !newStatus) {
      throw new BadRequestException(
        'Faltan parámetros de contacto (subject/status)',
      );
    }

    const created = await this.repository.create({
      subjectId: subject.id,
      companyName: dto.companyName,
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
      statusId: newStatus.id,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });

    // Correos best-effort (no rompen el flujo si fallan): aviso interno a los
    // admins y confirmación de recepción al cliente.
    void this.notifyAdmins(created, subject.label);
    void this.notifyClient(created, subject.label);

    // El front solo necesita confirmación; no devolvemos el lead completo.
    return { received: true, id: created.id };
  }

  private async notifyClient(
    lead: Awaited<ReturnType<ContactRequestsRepository['create']>>,
    subjectLabel: string,
  ) {
    try {
      await this.mailService.sendContactRequestClientEmail({
        to: lead.email,
        fullName: lead.fullName,
        companyName: lead.companyName,
        subjectLabel,
        message: lead.message,
      });
    } catch (e) {
      this.logger.error(
        `No se pudo enviar la confirmación del lead ${lead.id} al cliente: ${
          (e as Error).message
        }`,
      );
    }
  }

  private async notifyAdmins(
    lead: Awaited<ReturnType<ContactRequestsRepository['create']>>,
    subjectLabel: string,
  ) {
    try {
      const adminEmails =
        await this.platformAdminRepository.findActiveAdminEmails();
      if (adminEmails.length === 0) {
        this.logger.warn(
          `Lead ${lead.id} recibido pero no hay admins activos a quien notificar`,
        );
        return;
      }
      await Promise.all(
        adminEmails.map((to) =>
          this.mailService.sendContactRequestAdminEmail({
            to,
            subjectLabel,
            companyName: lead.companyName,
            fullName: lead.fullName,
            email: lead.email,
            phone: lead.phone,
            message: lead.message,
          }),
        ),
      );
    } catch (e) {
      this.logger.error(
        `No se pudo notificar el lead ${lead.id} a los admins: ${
          (e as Error).message
        }`,
      );
    }
  }

  // ── Panel admin ───────────────────────────────────────────────────────

  private async buildWhere(
    filters: FilterContactRequestDto,
  ): Promise<Prisma.ContactRequestWhereInput> {
    const where: Prisma.ContactRequestWhereInput = {};

    if (filters.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'contact_status',
        filters.status,
      );
      where.statusId = status?.id ?? -1;
    }
    if (filters.subject) {
      const subject = await this.repository.findParameterByTypeAndCode(
        'contact_subject',
        filters.subject,
      );
      where.subjectId = subject?.id ?? -1;
    }
    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async findAll(filters: FilterContactRequestDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters);

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const lead = await this.repository.findById(id);
    if (!lead) {
      throw new NotFoundException(`Solicitud con id=${id} no encontrada`);
    }
    return lead;
  }

  /**
   * Gestiona un lead: estado, asignación y/o notas. Al pasar a 'closed' marca
   * handledBy (admin del token) y handledAt; al reabrir, los limpia.
   */
  async update(
    id: string,
    dto: UpdateContactRequestDto,
    userId: string,
  ) {
    await this.findOne(id);

    const data: Prisma.ContactRequestUncheckedUpdateInput = {};

    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.assignedTo !== undefined) data.assignedTo = dto.assignedTo;

    if (dto.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'contact_status',
        dto.status,
      );
      if (!status) {
        throw new BadRequestException(`Estado inválido: ${dto.status}`);
      }
      data.statusId = status.id;
      if (dto.status === 'closed') {
        const admin = await this.repository.findPlatformAdminByUserId(userId);
        data.handledBy = admin?.id ?? null;
        data.handledAt = new Date();
      } else {
        // Reabrir / volver a gestión limpia la marca de cierre.
        data.handledBy = null;
        data.handledAt = null;
      }
    }

    return this.repository.update(id, data);
  }
}
