import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { normalizeProductLanguage } from '../product/product-language';
import { AiService } from '../ai/ai.service';

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  children: CategoryNode[];
};

@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async list(lang?: string) {
    const language = normalizeProductLanguage(lang);

    const rows = await this.prisma.category.findMany({
      include: {
        translations: {
          where: { language },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return rows.map(({ translations, ...category }) => ({
      ...category,
      name: translations[0]?.name || category.name,
    }));
  }

  async tree(rootId?: string, lang?: string) {
    const language = normalizeProductLanguage(lang);

    const rows = await this.prisma.category.findMany({
      include: {
        translations: {
          where: { language },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    const map = new Map<string, CategoryNode>();

    for (const { translations, ...category } of rows) {
      map.set(category.id, {
        ...category,
        name: translations[0]?.name || category.name,
        children: [],
      });
    }

    const roots: CategoryNode[] = [];

    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    if (rootId) {
      return map.get(rootId) ?? null;
    }

    return roots;
  }
}
