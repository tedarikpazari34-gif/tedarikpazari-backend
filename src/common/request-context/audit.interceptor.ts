import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestContextService } from './request-context.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly context: RequestContextService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // ✅ set(key, value) şeklinde
    this.context.set('actorId', user?.userId ?? null);
    this.context.set('actorRole', user?.role ?? null);
    this.context.set('actorCompanyId', user?.companyId ?? null);
    this.context.set('ip', req.ip ?? null);
    this.context.set('userAgent', req.headers?.['user-agent'] ?? null);

    return next.handle().pipe(
      tap({
        next: async () => {
          // İstersen burada "REQUEST_OK" gibi bir audit bırakabilirsin
          // Şimdilik boş bırakıyorum (production’da log spam olmasın)
        },
        error: async (err) => {
          // ❗ Hata olunca audit log
          await this.prisma.auditLog.create({
            data: {
              actorId: user?.userId ?? null,
              actorRole: user?.role ?? null,
              actorCompanyId: user?.companyId ?? null,
              action: 'REQUEST_ERROR',
              entity: req.route?.path ?? req.url ?? 'unknown',
              entityId: null,
              success: false,
              errorMessage: err?.message ?? String(err),
              ip: req.ip ?? null,
              userAgent: req.headers?.['user-agent'] ?? null,
              metadata: {
                method: req.method,
                path: req.url,
              },
            },
          });
        },
      }),
    );
  }
}