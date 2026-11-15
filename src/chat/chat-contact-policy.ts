// Mesajların dış iletişim kanallarına yönlendirilmesini önleyen ortak kontrol.
export function hasForbiddenChatContactInfo(content: string): boolean {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex =
    /(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/;
  const urlRegex = /(https?:\/\/|www\.|\.com|\.net|\.org|\.tr)/i;

  return (
    emailRegex.test(content) ||
    phoneRegex.test(content) ||
    urlRegex.test(content)
  );
}
