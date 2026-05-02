const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: {
      email: "selma_ferit@hotmail.com",
    },
    select: {
      id: true,
      email: true,
      role: true,
      companyId: true,
    },
  });

  if (!user) {
    throw new Error("User bulunamadı");
  }

  console.log("USER:", user);

  await prisma.company.update({
    where: {
      id: user.companyId,
    },
    data: {
      role: "LOGISTICS",
      status: "APPROVED",
    },
  });

  await prisma.user.update({
    where: {
      email: "selma_ferit@hotmail.com",
    },
    data: {
      role: "LOGISTICS",
    },
  });

  console.log("✅ COMPANY + USER LOGISTICS yapıldı");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());