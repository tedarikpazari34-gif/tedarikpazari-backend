import { PrismaClient, CompanyStatus, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const categorySeed = [
  {
    name: "Ambalaj ve Paketleme",
    children: [
      "Koli ve Karton Ambalaj",
      "Plastik Ambalaj",
      "Endüstriyel Ambalaj",
      "Etiket ve Baskı",
      "Koli Bandı",
    ],
  },
  {
    name: "Temizlik ve Hijyen",
    children: [
      "Endüstriyel Temizlik",
      "Kağıt Ürünleri",
      "Temizlik Ekipmanları",
      "Hijyen Sarf Malzemeleri",
    ],
  },
  {
    name: "Hırdavat",
    children: [
      "Vida ve Bağlantı Elemanları",
      "El Aletleri",
      "Elektrikli El Aletleri",
      "Kesici ve Delici Aletler",
      "Yapıştırıcı ve Kimyasallar",
      "İş Güvenliği",
    ],
  },
  {
    name: "Elektrik ve Aydınlatma",
    children: [
      "Elektrik Malzemeleri",
      "Aydınlatma",
      "Endüstriyel Elektrik",
      "Kablo ve Kablo Kanalları",
    ],
  },
  {
    name: "Gıda ve Horeca",
    children: [
      "Gıda Hammaddeleri",
      "Kahve ve İçecek",
      "Horeca Tedarik",
      "Tek Kullanımlık Ürünler",
    ],
  },
  {
    name: "Otomotiv ve Yedek Parça",
    children: [
      "Motor Parçaları",
      "Bakım Ürünleri",
      "Fren Sistemleri",
      "Elektrik Parçaları",
    ],
  },
];

async function ensureCategoryTree() {
  for (const parentCategory of categorySeed) {
    let parent = await prisma.category.findFirst({
      where: {
        name: parentCategory.name,
        parentId: null,
      },
    });

    if (!parent) {
      parent = await prisma.category.create({
        data: {
          name: parentCategory.name,
          parentId: null,
        },
      });

      console.log(`✅ Parent category created: ${parent.name}`);
    } else {
      console.log(`↩️ Parent category exists: ${parent.name}`);
    }

    for (const childName of parentCategory.children) {
      const existingChild = await prisma.category.findFirst({
        where: {
          name: childName,
          parentId: parent.id,
        },
      });

      if (!existingChild) {
        await prisma.category.create({
          data: {
            name: childName,
            parentId: parent.id,
          },
        });

        console.log(`   ✅ Child category created: ${childName}`);
      } else {
        console.log(`   ↩️ Child category exists: ${childName}`);
      }
    }
  }
}

async function ensureCompanyWallet(companyId: string) {
  await prisma.companyWallet.upsert({
    where: { companyId },
    update: {
      available: 100000,
      locked: 0,
    },
    create: {
      companyId,
      available: 100000,
      locked: 0,
    },
  });
}

async function ensureAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@tedarikpazari.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const adminCompanyName = process.env.ADMIN_COMPANY_NAME || "Tedarik Pazarı Admin";

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const adminCompany = await prisma.company.upsert({
    where: { id: "system-admin-company" },
    update: {
      name: adminCompanyName,
      email: adminEmail,
      status: CompanyStatus.APPROVED,
      role: Role.ADMIN,
    },
    create: {
      id: "system-admin-company",
      name: adminCompanyName,
      email: adminEmail,
      status: CompanyStatus.APPROVED,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: hashedPassword,
      companyId: adminCompany.id,
    },
    create: {
      email: adminEmail,
      password: hashedPassword,
      companyId: adminCompany.id,
    },
  });

  await ensureCompanyWallet(adminCompany.id);

  console.log(`✅ Admin ready: ${adminEmail}`);
}

async function ensureDevUsers() {
  if (process.env.NODE_ENV === "production") {
    console.log("ℹ️ Production mode: test users skipped");
    return;
  }

  const hashedPassword = await bcrypt.hash("123456", 10);

  const sellerCompany = await prisma.company.upsert({
    where: { id: "seed-seller-company" },
    update: {
      name: "Test Supplier Company",
      email: "seller-company@test.com",
      status: CompanyStatus.APPROVED,
      role: Role.SELLER,
    },
    create: {
      id: "seed-seller-company",
      name: "Test Supplier Company",
      email: "seller-company@test.com",
      status: CompanyStatus.APPROVED,
      role: Role.SELLER,
    },
  });
  await ensureCompanyWallet(sellerCompany.id);
  const buyerCompany = await prisma.company.upsert({
    where: { id: "seed-buyer-company" },
    update: {
      name: "Test Buyer Company",
      email: "buyer-company@test.com",
      status: CompanyStatus.APPROVED,
      role: Role.BUYER,
    },
    create: {
      id: "seed-buyer-company",
      name: "Test Buyer Company",
      email: "buyer-company@test.com",
      status: CompanyStatus.APPROVED,
      role: Role.BUYER,
    },
  });
  await ensureCompanyWallet(buyerCompany.id);
  await prisma.user.upsert({
    where: { email: "seller@test.com" },
    update: {
      password: hashedPassword,
      companyId: sellerCompany.id,
    },
    create: {
      email: "seller@test.com",
      password: hashedPassword,
      companyId: sellerCompany.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "buyer@test.com" },
    update: {
      password: hashedPassword,
      companyId: buyerCompany.id,
    },
    create: {
      email: "buyer@test.com",
      password: hashedPassword,
      companyId: buyerCompany.id,
    },
  });

  await ensureCompanyWallet(sellerCompany.id);
  await ensureCompanyWallet(buyerCompany.id);

  console.log("✅ Dev test users ready");
}

async function main() {
  console.log("🌱 Seed started...");

  await ensureCategoryTree();
  await ensureAdmin();
  await ensureDevUsers();

  console.log("✅ Seed completed successfully");
  console.log("ℹ️ No demo products were created");
  console.log("ℹ️ Real products must be created by sellers via the app");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });