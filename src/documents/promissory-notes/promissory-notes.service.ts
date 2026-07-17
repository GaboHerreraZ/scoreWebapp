import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { ParametersRepository } from '../../parameters/parameters.repository.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

/**
 * Pagarés. La integración de FIRMA fue retirada (DocuSeal se eliminó del
 * sistema): hoy el módulo solo consulta y declina pagarés existentes. La
 * generación/envío a firma del pagaré se reconectará con el proveedor de firma
 * vigente (Zapsign, ver SigningModule) cuando se retome el flujo.
 */
@Injectable()
export class PromissoryNotesService {
  private readonly logger = new Logger(PromissoryNotesService.name);

  constructor(
    private readonly repository: PromissoryNotesRepository,
    private readonly prisma: PrismaService,
    private readonly parametersRepository: ParametersRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findById(id: number, companyId: string) {
    const note = await this.repository.findById(id, companyId);
    if (!note) {
      throw new NotFoundException(
        `No se encontró el pagaré con id=${id} en esta empresa.`,
      );
    }
    return note;
  }

  /**
   * Declines (cancels) a promissory note that is pending signature: marks it
   * as DECLINED and reverts the credit study status back to `estudioRealizado`
   * so a new document can be sent.
   */
  async decline(id: number, companyId: string) {
    const note = await this.repository.findById(id, companyId);
    if (!note) {
      throw new NotFoundException(
        `No se encontró el pagaré con id=${id} en esta empresa.`,
      );
    }

    // Only pending notes can be declined
    const pendingStatus = await this.parametersRepository.findByTypeAndCode(
      'promissory_note_status',
      'pendingSignature',
    );
    if (note.statusId !== pendingStatus?.id) {
      throw new BadRequestException(
        'Solo se pueden declinar pagarés que estén pendientes de firma.',
      );
    }

    // 1. Mark promissory note as DECLINED
    const declinedStatus = await this.parametersRepository.findByTypeAndCode(
      'promissory_note_status',
      'declined',
    );
    const updated = await this.repository.update(id, {
      statusId: declinedStatus?.id,
      declinedAt: new Date(),
    });

    // 2. Revert credit study status to estudioRealizado
    const estudioRealizadoStatus =
      await this.parametersRepository.findByCode('studyCompleted');
    if (estudioRealizadoStatus) {
      await this.prisma.creditStudy.update({
        where: { id: note.creditStudyId },
        data: { statusId: estudioRealizadoStatus.id },
      });
    }

    // 3. Emit notification
    this.emitNotification(
      note.createdBy,
      companyId,
      `Pagaré declinado`,
      `El pagaré #${id} fue declinado.`,
      `/app/credit-study/detail/${note.creditStudyId}`,
    );

    return updated;
  }

  async findAll(companyId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const { data, total } = await this.repository.findAll({
      skip,
      take: limit,
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private emitNotification(
    userId: string,
    companyId: string,
    title: string,
    message: string,
    route: string,
  ): void {
    this.parametersRepository
      .findByTypeAndCode('notification_type', 'promissory_note')
      .then((type) => {
        if (!type) return;
        return this.notificationsService.create(userId, {
          companyId,
          typeId: type.id,
          title,
          message,
          route,
        });
      })
      .catch(() => {});
  }
}
