import { readFileSync } from 'node:fs';

describe('Chat file review Prisma schema contract', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');

  function block(kind: string, name: string): string {
    const pattern = new RegExp(
      `^${kind} ${name} \\{([\\s\\S]*?)^\\}`,
      'm',
    );

    return schema.match(pattern)?.[1] ?? '';
  }

  it('uc ayri dosya inceleme durumu tanimlidir', () => {
    const states = block('enum', 'ChatFileReviewStatus');

    expect(states).toMatch(/\bPENDING_REVIEW\b/);
    expect(states).toMatch(/\bAPPROVED\b/);
    expect(states).toMatch(/\bREJECTED\b/);
  });

  it('yeni dosyalar varsayilan olarak inceleme bekler', () => {
    const model = block('model', 'ChatFileReview');

    expect(model).toMatch(
      /status\s+ChatFileReviewStatus\s+@default\(PENDING_REVIEW\)/,
    );
  });

  it('her mesaj icin tek dosya inceleme kaydi vardir', () => {
    const model = block('model', 'ChatFileReview');

    expect(model).toMatch(/messageId\s+String\s+@unique/);
    expect(model).toContain('message ChatMessage @relation(');
  });

  it('admin karari ve inceleme zamani saklanabilir', () => {
    const model = block('model', 'ChatFileReview');

    expect(model).toMatch(/reviewedById\s+String\?/);
    expect(model).toMatch(/reviewedAt\s+DateTime\?/);
    expect(model).toMatch(/reviewNote\s+String\?/);
  });

  it('mevcut metin moderasyonu alanlari korunur', () => {
    const model = block('model', 'ChatMessage');

    expect(model).toMatch(/isFlagged\s+Boolean/);
    expect(model).toMatch(/reviewDecision\s+String\?/);
    expect(model).toMatch(/fileReview\s+ChatFileReview\?/);
  });
});
