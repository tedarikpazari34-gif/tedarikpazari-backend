import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * İçerik moderasyonu tamamlanmadan sohbet dosyaları
 * kesinlikle kabul edilmez.
 *
 * Bu kilit ortam değişkeniyle açılamaz.
 *
 * Gelecekte ancak gerçek içerik incelemesi, karantina,
 * admin onayı ve erişim kontrolleri tamamlandıktan
 * sonra ayrı bir güvenlik incelemesiyle değiştirilebilir.
 */
@Injectable()
export class ChatFileContentReviewGuard implements CanActivate {
  canActivate(): never {
    throw new ServiceUnavailableException(
      'Sohbet dosyasi icerik moderasyonu henuz hazir degil',
    );
  }
}
