import * as express from 'express';
import * as request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isAllowedPublicUploadPath } from './public-upload-path';

describe('Public upload static access security', () => {
  let root: string;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nex-upload-security-'));
    mkdirSync(join(root, 'chat'));
    writeFileSync(join(root, 'public.png'), 'PUBLIC');
    writeFileSync(join(root, 'chat', 'secret.pdf'), 'PRIVATE');

    app = express();

    app.use('/uploads', (req, res, next) => {
      if (!isAllowedPublicUploadPath(req.path)) {
        res.sendStatus(404);
        return;
      }

      next();
    });

    app.use('/uploads', express.static(root));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('ana klasördeki mevcut dosyaları sunar', async () => {
    const response = await request(app).get('/uploads/public.png');

    expect(response.status).toBe(200);
  });

  it('sohbet dosyalarını anonim erişime kapatır', async () => {
    const response = await request(app).get(
      '/uploads/chat/secret.pdf',
    );

    expect(response.status).toBe(404);
  });

  it('kodlanmış dosya yollarını reddeder', async () => {
    const response = await request(app).get(
      '/uploads/chat%2Fsecret.pdf',
    );

    expect(response.status).toBe(404);
  });

  it('gizli dosya yollarını reddeder', async () => {
    const response = await request(app).get('/uploads/.env');

    expect(response.status).toBe(404);
  });

  it('alt klasörleri ve ters eğik çizgileri reddeder', () => {
    expect(isAllowedPublicUploadPath('/chat/secret.pdf')).toBe(false);
    expect(isAllowedPublicUploadPath('/other/file.png')).toBe(false);
    expect(isAllowedPublicUploadPath('/chat\\secret.pdf')).toBe(false);
    expect(isAllowedPublicUploadPath('/public.png')).toBe(true);
  });
});
