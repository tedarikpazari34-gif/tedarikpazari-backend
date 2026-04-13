import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
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

async function main() {
  for (const category of categories) {
    const parent = await prisma.category.create({
      data: {
        name: category.name,
      },
    });

    for (const child of category.children) {
      await prisma.category.create({
        data: {
          name: child,
          parentId: parent.id,
        },
      });
    }
  }

  console.log("✅ Categories seeded successfully");
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });