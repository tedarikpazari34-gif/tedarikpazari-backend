import { PrismaClient, Role, CompanyStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@admin.com';
  const adminPassword = '123456';
  const companyName = 'Admin Company';

  // 1) Company oluştur (name unique değil, o yüzden upsert yapmıyoruz)
  // Aynı isimli company varsa ilkini alıp kullanacağız (seed idempotent olsun diye)
  let company = await prisma.company.findFirst({
    where: { name: companyName, role: Role.ADMIN },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: companyName,
        role: Role.ADMIN,
        status: CompanyStatus.APPROVED,
        email: adminEmail,
      },
    });
  }

  // 2) User upsert (email unique)
  const hashed = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: hashed,
      companyId: company.id,
    },
    create: {
      email: adminEmail,
      password: hashed,
      companyId: company.id,
    },
  });

  console.log('✅ Seed done:', { adminEmail, adminPassword, companyId: company.id });
}

main()
  .catch((e) => {
    console.error('❌ Seed error', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });