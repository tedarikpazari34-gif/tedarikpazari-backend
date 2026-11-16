import {
  canParticipantSeeChatMessage,
} from './chat-file-review-policy';

describe('Chat file quarantine participant visibility', () => {
  const file = {
    isFlagged: false,
    fileUrl: 'chat-private:tedarik-pazari-platform/chat/example',
    fileName: 'Belge.pdf',
    fileType: 'application/pdf',
  };

  it('normal metin mesajini korur', () => {
    expect(
      canParticipantSeeChatMessage({ isFlagged: false }),
    ).toBe(true);
  });

  it('engellenmis metin mesajini gizler', () => {
    expect(
      canParticipantSeeChatMessage({ isFlagged: true }),
    ).toBe(false);
  });

  it('inceleme bekleyen dosyayi gizler', () => {
    expect(
      canParticipantSeeChatMessage({
        ...file,
        fileReview: { status: 'PENDING_REVIEW' },
      }),
    ).toBe(false);
  });

  it('reddedilen dosyayi gizler', () => {
    expect(
      canParticipantSeeChatMessage({
        ...file,
        fileReview: { status: 'REJECTED' },
      }),
    ).toBe(false);
  });

  it('inceleme kaydi olmayan dosyayi gizler', () => {
    expect(
      canParticipantSeeChatMessage(file),
    ).toBe(false);
  });

  it('onaylanan ozel dosyaya gorunurluk izni verir', () => {
    expect(
      canParticipantSeeChatMessage({
        ...file,
        fileReview: { status: 'APPROVED' },
      }),
    ).toBe(true);
  });

  it('eski herkese acik dosya adresini reddeder', () => {
    expect(
      canParticipantSeeChatMessage({
        ...file,
        fileUrl: '/uploads/chat/example.pdf',
        fileReview: { status: 'APPROVED' },
      }),
    ).toBe(false);
  });

  it('dosya adresi eksik olan kaydi reddeder', () => {
    expect(
      canParticipantSeeChatMessage({
        fileName: 'Belge.pdf',
        fileReview: { status: 'APPROVED' },
      }),
    ).toBe(false);
  });

  it('bilinmeyen inceleme durumunu reddeder', () => {
    expect(
      canParticipantSeeChatMessage({
        ...file,
        fileReview: { status: 'UNKNOWN' },
      }),
    ).toBe(false);
  });
});
