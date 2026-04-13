import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // ✅ AUDIT helper
  async audit(params: {
    actorId?: string;
    actorRole?: string;
    actorCompanyId?: string;
    action: string;
    entity: string;
    entityId?: string;
    success?: boolean;
    errorMessage?: string;
    metadata?: any;
  }) {
    return this.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        actorRole: params.actorRole ?? null,
        actorCompanyId: params.actorCompanyId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        success: params.success ?? true,
        errorMessage: params.errorMessage ?? null,
        metadata: params.metadata ?? undefined,
      },
    });
  }
}