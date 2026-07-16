import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ChatThreadType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly mailService: MailService,
  ) {}

  private hasForbiddenContactInfo(content: string) {
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const phoneRegex =
      /(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/;
    const urlRegex = /(https?:\/\/|www\.|\.com|\.net|\.org|\.tr)/i;

    return (
      emailRegex.test(content) ||
      phoneRegex.test(content) ||
      urlRegex.test(content)
    );
  }

  private async canAccessThread(user: any, threadId: string) {
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        buyer: true,
        seller: true,
        logistics: true,
        shippingOrder: true,
      },
    });

    if (!thread) {
      throw new NotFoundException('Chat bulunamadı');
    }

    const isAdmin = user.role === Role.ADMIN;
    const isBuyer = thread.buyerId === user.companyId;
    const isSeller = thread.sellerId === user.companyId;
    const isLogistics = thread.logisticsId === user.companyId;

    if (!isAdmin && !isBuyer && !isSeller && !isLogistics) {
      throw new ForbiddenException('Bu chate erişemezsiniz');
    }

    return thread;
  }

  async createThreadForRfq(user: any, rfqId: string) {
    const rfq = await this.prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        product: true,
      },
    });

    if (!rfq || !rfq.product) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (user.role !== Role.BUYER && user.role !== Role.SELLER) {
      throw new ForbiddenException('Chat başlatamazsınız');
    }

    const buyerId = rfq.buyerId;
    const sellerId = rfq.product.sellerId;

    if (user.companyId !== buyerId && user.companyId !== sellerId) {
      throw new ForbiddenException('Bu RFQ için chat açamazsınız');
    }

    const existingThread = await this.prisma.chatThread.findFirst({
      where: {
        rfqId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: true,
        seller: true,
        logistics: true,
        shippingOrder: true,
        rfq: {
          include: {
            product: true,
          },
        },
      },
    });

    if (existingThread) {
      return existingThread;
    }

    return this.prisma.chatThread.create({
      data: {
        type: ChatThreadType.RFQ,
        rfqId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: true,
        seller: true,
        logistics: true,
        shippingOrder: true,
        rfq: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async createThreadForOrder(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (user.role !== Role.BUYER && user.role !== Role.SELLER) {
      throw new ForbiddenException('Chat başlatamazsınız');
    }

    const buyerId = order.buyerId;
    const sellerId = order.sellerId;

    if (user.companyId !== buyerId && user.companyId !== sellerId) {
      throw new ForbiddenException('Bu sipariş için chat açamazsınız');
    }

    const existingThread = await this.prisma.chatThread.findFirst({
      where: {
        orderId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: true,
        seller: true,
        order: true,
      },
    });

    if (existingThread) {
      return existingThread;
    }

    return this.prisma.chatThread.create({
      data: {
        type: ChatThreadType.ORDER,
        orderId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: true,
        seller: true,
        order: true,
      },
    });
  }

  async listMine(user: any) {
    if (user.role === Role.ADMIN) {
      return this.prisma.chatThread.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          buyer: true,
          seller: true,
          logistics: true,
          shippingOrder: true,
          rfq: {
            include: {
              product: true,
            },
          },
          order: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    }

    return this.prisma.chatThread.findMany({
      where: {
        OR: [
          { buyerId: user.companyId },
          { sellerId: user.companyId },
          { logisticsId: user.companyId },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        buyer: true,
        seller: true,
        rfq: {
          include: {
            product: true,
          },
        },
        order: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async getMessages(user: any, threadId: string) {
    await this.canAccessThread(user, threadId);

    await this.prisma.chatMessage.updateMany({
      where: {
        threadId,
        isRead: false,
        NOT: {
          senderId: user.id,
        },
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return this.prisma.chatMessage.findMany({
      where: {
        threadId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            companyId: true,
          },
        },
      },
    });
  }

  async listFlaggedMessages(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN erişebilir');
    }

    return this.prisma.chatMessage.findMany({
      where: {
        isFlagged: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            role: true,
            companyId: true,
          },
        },
        thread: {
          include: {
            buyer: true,
            seller: true,
            rfq: {
              include: {
                product: true,
              },
            },
            order: true,
          },
        },
      },
    });
  }
  async getUnreadCount(user: any) {
    return this.prisma.chatMessage.count({
      where: {
        isRead: false,
        senderId: {
          not: user.id,
        },
        thread: {
          OR: [
            { buyerId: user.companyId },
            { sellerId: user.companyId },
            { logisticsId: user.companyId },
          ],
        },
      },
    });
  }
  async sendMessage(user: any, threadId: string, content: string) {
    const thread = await this.canAccessThread(user, threadId);

    if (!content || !content.trim()) {
      throw new BadRequestException('Mesaj boş olamaz');
    }

    const cleanContent = content.trim();
    const isFlagged = this.hasForbiddenContactInfo(cleanContent);

    if (isFlagged) {
      throw new BadRequestException(
        'Platform dışı iletişim bilgisi, telefon, e-posta veya link paylaşımı yasaktır.',
      );
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        threadId,
        senderId: user.id,
        content: cleanContent,
        isFlagged,
      },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        updatedAt: new Date(),
      },
    });

    const receiverCompanyId =
      user.companyId === thread.buyerId ? thread.sellerId : thread.buyerId;

    const receiverUsers = await this.prisma.user.findMany({
      where: {
        companyId: receiverCompanyId,
      },
    });

    await Promise.all(
      receiverUsers.map((receiver) =>
        this.prisma.notification.create({
          data: {
            userId: receiver.id,
            type: 'SYSTEM',
            title: 'Yeni mesajınız var',
            message: cleanContent,
            link: '/chat',
          },
        }),
      ),
    );
    await Promise.all(
      receiverUsers
        .filter((receiver) => receiver.email)
        .map((receiver) =>
          this.mailService.sendNewMessageEmail(receiver.email, cleanContent),
        ),
    );

    this.chatGateway.emitNewMessage(threadId, message);
    return message;
  }
  async sendFileMessage(
    user: any,
    threadId: string,
    file: Express.Multer.File,
  ) {
    const thread = await this.canAccessThread(user, threadId);

    if (!file) {
      throw new BadRequestException('Dosya bulunamadı');
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Sadece JPG, PNG, WEBP veya PDF dosyası gönderilebilir',
      );
    }

    const fileUrl = `/uploads/chat/${file.filename}`;

    const message = await this.prisma.chatMessage.create({
      data: {
        threadId,
        senderId: user.id,
        content: file.originalname,
        fileUrl,
        fileName: file.originalname,
        fileType: file.mimetype,
      },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        updatedAt: new Date(),
      },
    });

    const receiverCompanyId =
      user.companyId === thread.buyerId ? thread.sellerId : thread.buyerId;

    const receiverUsers = await this.prisma.user.findMany({
      where: {
        companyId: receiverCompanyId,
      },
    });

    await Promise.all(
      receiverUsers.map((receiver) =>
        this.prisma.notification.create({
          data: {
            userId: receiver.id,
            type: 'SYSTEM',
            title: 'Yeni dosya gönderildi',
            message: file.originalname,
            link: '/chat',
          },
        }),
      ),
    );

    this.chatGateway.emitNewMessage(threadId, message);

    return message;
  }
}
