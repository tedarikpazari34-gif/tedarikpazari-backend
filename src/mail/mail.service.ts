import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  async sendMail(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    if (!params.to) return null;

    return this.transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }

  async sendNewMessageEmail(to: string, message: string) {
    return this.sendMail({
      to,
      subject: 'Tedarik Pazarı - Yeni mesajınız var',
      text: `Yeni mesajınız var: ${message}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>Yeni mesajınız var</h2>
          <p>${message}</p>
          <p>Mesajı görüntülemek için Tedarik Pazarı hesabınıza giriş yapın.</p>
        </div>
      `,
    });
  }
}