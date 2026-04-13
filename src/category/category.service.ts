import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  children: CategoryNode[];
};

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
  }

    async tree(rootId?: string) {
  const rows = await this.prisma.category.findMany({
    orderBy: { name: 'asc' },
  });

  console.log(
    'CATEGORY ROWS:',
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
    })),
  );

  const map = new Map<string, CategoryNode>();

  for (const c of rows) {
    map.set(c.id, { ...c, children: [] });
  }

  const roots: CategoryNode[] = [];

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  console.log(
    'CATEGORY ROOTS:',
    roots.map((r) => ({
      id: r.id,
      name: r.name,
      childrenCount: r.children.length,
    })),
  );

  if (rootId) {
    return map.get(rootId) ?? null;
  }

  return roots;
}
}