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

  {
    name: "Dental ve Diş Hekimliği",
    children: [
      "Dental Sarf Malzemeleri",
      "Endodonti",
      "Restoratif Diş Hekimliği",
      "Protez ve Dental Laboratuvar",
      "Ortodonti",
      "Cerrahi ve İmplantoloji",
      "Dental El Aletleri",
      "Dental Cihaz ve Ekipman",
      "Dezenfeksiyon ve Sterilizasyon",
      "Diş Hekimliği Öğrenci Malzemeleri",
    ],
  },

  {
    name: "Medikal ve Sağlık",
    children: [
      "Medikal Sarf Malzemeleri",
      "Muayene ve Klinik Ekipmanları",
      "Hasta Bakım Ürünleri",
      "Sterilizasyon Ürünleri",
    ],
  },

  {
    name: "Tekstil ve Konfeksiyon",
    children: [
      "Kumaş",
      "İplik",
      "Düğme ve Aksesuar",
      "Fermuar",
      "Fason Dikim",
      "Konfeksiyon Sarf Malzemeleri",
    ],
  },

  {
    name: "Eğitim ve Okul Malzemeleri",
    children: [
      "Okul Kırtasiyesi",
      "Üniversite Malzemeleri",
      "Sanat ve Çizim Malzemeleri",
      "Laboratuvar Eğitim Setleri",
      "Toplu Okul İhtiyaçları",
    ],
  },

  {
    name: "Kozmetik ve Kuaför",
    children: [
      "Kuaför Sarf Malzemeleri",
      "Profesyonel Saç Ürünleri",
      "Cilt Bakım Ürünleri",
      "Salon Ekipmanları",
    ],
  },

  {
    name: "Laboratuvar",
    children: [
      "Laboratuvar Sarf Malzemeleri",
      "Cam Malzemeler",
      "Ölçüm ve Test Cihazları",
      "Laboratuvar Ekipmanları",
    ],
  },

  {
    name: "Veteriner ve Pet Ürünleri",
    children: [
      "Veteriner Sarf Malzemeleri",
      "Klinik Ekipmanları",
      "Pet Bakım Ürünleri",
      "Mama ve Beslenme",
    ],
  },

  {
    name: "Fason Üretim ve Özel Üretim",
    children: [
      "Fason Tekstil Üretimi",
      "Fason Kozmetik Üretimi",
      "Fason Gıda Üretimi",
      "Özel Ambalaj Üretimi",
      "Markaya Özel Üretim",
    ],
  },

  {
    name: "Diğer Ürün ve Hizmetler",
    children: [
      "Diğer Ürünler",
      "Diğer Sarf Malzemeleri",
      "Diğer Ekipmanlar",
      "Diğer Hizmetler",
      "Kategorisi Belirlenemeyen Ürünler",
    ],
  },

  {
    name: "İnşaat ve Yapı Malzemeleri",
    children: [
      "Çimento ve Harç",
      "Boya ve Kaplama",
      "Yapı Kimyasalları",
      "İzolasyon Malzemeleri",
      "İnşaat Sarf Malzemeleri",
    ],
  },
  {
    name: "Metal ve Çelik",
    children: [
      "Sac",
      "Profil",
      "Boru",
      "Paslanmaz Çelik",
      "Metal İşleme Ürünleri",
    ],
  },
  {
    name: "Mobilya ve Ofis",
    children: [
      "Ofis Masaları",
      "Ofis Sandalyeleri",
      "Dolap ve Arşiv Sistemleri",
      "Toplantı Mobilyaları",
      "Ofis Aksesuarları",
    ],
  },
  {
    name: "Makine ve Ekipman",
    children: [
      "Üretim Makineleri",
      "Endüstriyel Ekipmanlar",
      "Kompresör ve Pnömatik",
      "Pompa Sistemleri",
      "Yedek Parça ve Bakım",
    ],
  },
  {
    name: "Sanayi Sarf Malzemeleri",
    children: [
      "Kesici Takımlar",
      "Kaynak Sarfları",
      "Taşlama ve Diskler",
      "Rulman ve Mekanik Sarf",
      "Bakım ve Yağlama Ürünleri",
    ],
  },
  {
    name: "Plastik ve Kimya",
    children: [
      "Plastik Hammadde",
      "Granül",
      "Endüstriyel Kimyasallar",
      "Solventler",
      "Yapıştırıcı ve Reçineler",
    ],
  },
  {
    name: "Tarım ve Hayvancılık",
    children: [
      "Sulama Sistemleri",
      "Tarım Ekipmanları",
      "Yem ve Besleme",
      "Seracılık Malzemeleri",
      "Hayvancılık Ekipmanları",
    ],
  },
  {
    name: "Lojistik ve Depolama",
    children: [
      "Palet",
      "Raf Sistemleri",
      "Depo Ekipmanları",
      "Ambalaj ve Sevkiyat",
      "Taşıma Hizmetleri",
    ],
  },
  {
    name: "Elektronik ve Teknoloji",
    children: [
      "Bilgisayar ve Çevre Birimleri",
      "Ağ ve Network",
      "Elektronik Bileşenler",
      "Yazıcı ve Ofis Teknolojileri",
      "Teknolojik Ekipmanlar",
    ],
  },
  {
    name: "İklimlendirme ve HVAC",
    children: [
      "Klima Sistemleri",
      "Havalandırma",
      "Soğutma Sistemleri",
      "HVAC Sarf Malzemeleri",
      "Filtre ve Kanal Sistemleri",
    ],
  },
  {
    name: "Su ve Tesisat",
    children: [
      "Boru ve Fittings",
      "Vana ve Armatür",
      "Sıhhi Tesisat",
      "Pompa ve Hidrofor",
      "Tesisat Sarf Malzemeleri",
    ],
  },
  {
    name: "Güvenlik ve Yangın Sistemleri",
    children: [
      "Kamera Sistemleri",
      "Alarm Sistemleri",
      "Yangın Söndürme",
      "Geçiş Kontrol Sistemleri",
      "Güvenlik Ekipmanları",
    ],
  },
  {
    name: "Reklam ve Promosyon",
    children: [
      "Promosyon Ürünleri",
      "Tabela ve Baskı",
      "Kurumsal Hediyeler",
      "Dijital Baskı",
      "Tanıtım Malzemeleri",
    ],
  },
  {
    name: "Kırtasiye ve Matbaa",
    children: [
      "Ofis Kırtasiyesi",
      "Kağıt Ürünleri",
      "Matbaa Sarf Malzemeleri",
      "Baskı Hizmetleri",
      "Etiket ve Ambalaj Baskı",
    ],
  },
  {
    name: "Enerji ve Güneş Sistemleri",
    children: [
      "Güneş Panelleri",
      "İnverter",
      "Enerji Depolama",
      "Solar Kablo ve Aksesuar",
      "Enerji Sistemleri Ekipmanları",
    ],
  },
  {
    name: "Maden ve Endüstriyel Üretim",
    children: [
      "Madencilik Ekipmanları",
      "Ağır Sanayi Ekipmanları",
      "Saha Sarf Malzemeleri",
      "Konveyör ve Taşıma Sistemleri",
      "Endüstriyel Üretim Ekipmanları",
    ],
  },];

async function ensureCategory(name: string, parentId: string | null = null) {
  const existing = await prisma.category.findFirst({
    where: {
      name,
      parentId,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.category.create({
    data: {
      name,
      parentId,
    },
  });
}

async function main() {
  for (const category of categories) {
    const parent = await ensureCategory(category.name);

    for (const child of category.children) {
      await ensureCategory(child, parent.id);
    }
  }

  console.log("✅ Categories synchronized successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
