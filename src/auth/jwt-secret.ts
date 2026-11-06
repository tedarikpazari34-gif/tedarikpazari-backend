export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET must be configured with at least 32 characters',
    );
  }

  return secret;
}
