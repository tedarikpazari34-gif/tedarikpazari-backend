import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: {
    userId?: string;
    companyId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    description?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
  requestId: null,

  actorId: data.userId,
  actorCompanyId: data.companyId,
  actorRole: null,

  action: data.action,

  entity: data.entityType,
  entityId: data.entityId,

  success: true,

  errorMessage: null,

  ip: data.ipAddress,

  userAgent: data.userAgent,

  metadata: data.metadata ?? Prisma.JsonNull,
},
    });
  }
}