import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as Iyzipay from 'iyzipay';

@Injectable()
export class IyzicoService {
  private readonly iyzipay: any;

  constructor() {
    const apiKey = process.env.IYZICO_API_KEY;
    const secretKey = process.env.IYZICO_SECRET_KEY;
    const baseUrl = process.env.IYZICO_BASE_URL;

    if (!apiKey || !secretKey || !baseUrl) {
      throw new Error(
        'Iyzico env eksik. IYZICO_API_KEY / IYZICO_SECRET_KEY / IYZICO_BASE_URL',
      );
    }

    this.iyzipay = new Iyzipay({
      apiKey,
      secretKey,
      uri: baseUrl,
    });
  }

  async createCheckoutFormInitialize(request: any): Promise<any> {
    try {
      const result: any = await new Promise((resolve, reject) => {
        this.iyzipay.checkoutFormInitialize.create(
          request,
          (err: any, res: any) => {
            if (err) {
              return reject(err);
            }
            resolve(res);
          },
        );
      });

      return result;
    } catch (error) {
      console.error('IYZICO CHECKOUT INIT ERROR', error);
      throw new InternalServerErrorException('iyzico checkout init failed');
    }
  }

  async retrieveCheckoutForm(token: string): Promise<any> {
    try {
      const result: any = await new Promise((resolve, reject) => {
        this.iyzipay.checkoutForm.retrieve(
          { token },
          (err: any, res: any) => {
            if (err) {
              return reject(err);
            }
            resolve(res);
          },
        );
      });

      return result;
    } catch (error) {
      console.error('IYZICO RETRIEVE ERROR', error);
      throw new InternalServerErrorException('iyzico retrieve failed');
    }
  }

  getClient() {
    return this.iyzipay;
  }
}