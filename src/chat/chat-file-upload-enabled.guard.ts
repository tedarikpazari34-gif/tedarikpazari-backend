import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class ChatFileUploadEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.CHAT_FILE_UPLOADS_ENABLED !== 'true') {
      throw new ServiceUnavailableException(
        'Sohbet dosyasi yukleme henuz etkin degil',
      );
    }

    return true;
  }
}
