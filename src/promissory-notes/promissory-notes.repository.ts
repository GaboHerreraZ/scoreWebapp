import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PromissoryNotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PromissoryNoteUncheckedCreateInput) {
    return this.prisma.promissoryNote.create({
      data,
      include: {
        status: true,
        customer: { select: { id: true, businessName: true, email: true } },
      },
    });
  }

  async findById(id: number, companyId: string) {
    return this.prisma.promissoryNote.findFirst({
      where: { id, companyId },
      include: {
        status: true,
        customer: {
          select: {
            id: true,
            businessName: true,
            email: true,
            identificationNumber: true,
          },
        },
        creditStudy: {
          select: { id: true, studyDate: true },
        },
      },
    });
  }

  async findByDocusealSubmissionId(submissionId: number) {
    return this.prisma.promissoryNote.findFirst({
      where: { docusealSubmissionId: submissionId },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.PromissoryNoteWhereInput;
    orderBy?: Prisma.PromissoryNoteOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.promissoryNote.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          status: true,
          customer: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.promissoryNote.count({ where }),
    ]);

    return { data, total };
  }

  async update(id: number, data: Prisma.PromissoryNoteUncheckedUpdateInput) {
    return this.prisma.promissoryNote.update({
      where: { id },
      data,
      include: { status: true },
    });
  }

  async countActiveByCreditStudy(creditStudyId: string): Promise<number> {
    const pendingStatus = await this.prisma.parameter.findUnique({
      where: {
        type_code: {
          type: 'promissory_note_status',
          code: 'pendingSignature',
        },
      },
    });
    const signedStatus = await this.prisma.parameter.findUnique({
      where: {
        type_code: { type: 'promissory_note_status', code: 'signed' },
      },
    });

    const activeStatusIds = [pendingStatus?.id, signedStatus?.id].filter(
      (v): v is number => typeof v === 'number',
    );

    return this.prisma.promissoryNote.count({
      where: {
        creditStudyId,
        statusId: { in: activeStatusIds },
      },
    });
  }
}
