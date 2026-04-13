import { CompanyStatusGuard } from './company-status.guard';

describe('CompanyStatusGuard', () => {
  it('should be defined', () => {
    const prismaMock: any = {
      company: { findUnique: jest.fn() },
    };
    expect(new CompanyStatusGuard(prismaMock)).toBeDefined();
  });
});