import { ChatGateway } from './chat.gateway';

describe('Chat file review socket privacy', () => {
  const gateway = new ChatGateway(
    {} as any,
    {} as any,
  );

  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));

  beforeEach(() => {
    emit.mockReset();
    to.mockClear();
    (gateway as any).server = { to };
  });

  it('onayda sadece yetkili sohbet odasina sinyal verir', () => {
    gateway.emitChatFileReviewChanged(
      'thread-1',
      'sender-1',
      'APPROVED',
    );

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('thread:thread-1');
    expect(emit).toHaveBeenCalledWith(
      'chatFileReviewChanged',
      { threadId: 'thread-1' },
    );
  });

  it('ret kararini yalniz gondericinin odasina gonderir', () => {
    gateway.emitChatFileReviewChanged(
      'thread-1',
      'sender-1',
      'REJECTED',
    );

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('user:sender-1');
    expect(to).not.toHaveBeenCalledWith('thread:thread-1');
  });

  it('dosya bilgilerini ve admin notunu yaymaz', () => {
    gateway.emitChatFileReviewChanged(
      'thread-1',
      'sender-1',
      'APPROVED',
    );

    const payload = JSON.stringify(emit.mock.calls);

    for (const secret of [
      'chat-private:',
      'reviewNote',
      'fileUrl',
      'fileName',
      'sender-1',
      'APPROVED',
    ]) {
      expect(payload).not.toContain(secret);
    }
  });

  it('gecersiz kimliklerle bildirim yapmaz', () => {
    gateway.emitChatFileReviewChanged(
      '../secret',
      'sender-1',
      'APPROVED',
    );

    gateway.emitChatFileReviewChanged(
      'thread-1',
      '',
      'REJECTED',
    );

    gateway.emitChatFileReviewChanged(
      null,
      'sender-1',
      'APPROVED',
    );

    expect(to).not.toHaveBeenCalled();
  });

  it('tanimsiz kararlari yaymaz', () => {
    gateway.emitChatFileReviewChanged(
      'thread-1',
      'sender-1',
      'PENDING_REVIEW',
    );

    expect(to).not.toHaveBeenCalled();
  });

  it('socket sunucusu hazir degilse sessizce cikar', () => {
    (gateway as any).server = undefined;

    expect(() =>
      gateway.emitChatFileReviewChanged(
        'thread-1',
        'sender-1',
        'APPROVED',
      ),
    ).not.toThrow();

    expect(to).not.toHaveBeenCalled();
  });
});
