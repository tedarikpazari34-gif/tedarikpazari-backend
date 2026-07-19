import {
  Body,
  Controller,
  Delete,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SavePushTokenDto } from './dto/save-push-token.dto';
import { PushService } from './push.service';

@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('token')
  saveToken(
    @Req() req: any,
    @Body() dto: SavePushTokenDto,
  ) {
    return this.pushService.saveToken(req.user.id, dto);
  }

  @Delete('token')
  removeToken(
    @Req() req: any,
    @Body('token') token: string,
  ) {
    return this.pushService.removeToken(req.user.id, token);
  }
}
