import {
  planProductStockThresholdUpdate as plan,
} from './product.service';

describe('Urun kritik stok esigi guncelleme kurali', () => {
  it('esik gonderilmezse uyari durumunu degistirmez', () => {
    expect(plan(10, undefined)).toEqual({
      where: {},
      data: {},
    });
  });

  it('ayni esik tekrar gonderilirse uyarilari sifirlamaz', () => {
    expect(plan(10, 10)).toEqual({
      where: {},
      data: {},
    });
  });

  it('esik degisirse yeni degeri ve uyari sifirlamasini yazar', () => {
    expect(plan(10, 25)).toEqual({
      where: { minStockThreshold: 10 },
      data: {
        minStockThreshold: 25,
        stockAlertActive: false,
      },
    });
  });

  it('esik kaldirilirsa bildirim durumunu sifirlar', () => {
    expect(plan(10, null)).toEqual({
      where: { minStockThreshold: 10 },
      data: {
        minStockThreshold: null,
        stockAlertActive: false,
      },
    });
  });

  it('ilk kez esik tanimlandiginda onceki null degeri korur', () => {
    expect(plan(null, 5)).toEqual({
      where: { minStockThreshold: null },
      data: {
        minStockThreshold: 5,
        stockAlertActive: false,
      },
    });
  });
});
