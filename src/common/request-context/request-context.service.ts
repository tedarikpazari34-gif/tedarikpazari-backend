import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

type Store = Map<string, any>;

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<Store>();

  run(callback: () => any) {
    return this.als.run(new Map(), callback);
  }

  set(key: string, value: any) {
    const store = this.als.getStore();
    if (store) store.set(key, value);
  }

  get<T = any>(key: string): T | undefined {
    const store = this.als.getStore();
    return store?.get(key);
  }
}