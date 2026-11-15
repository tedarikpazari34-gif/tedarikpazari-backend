/**
 * Public uploads are restricted to files directly under /uploads.
 * Private subdirectories must never be exposed by express.static.
 */
export function isAllowedPublicUploadPath(path: string): boolean {
  if (!path.startsWith('/') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(path.slice(1))) {
    return false;
  }

  const filename = path.slice(1).toLowerCase();

  return filename !== 'chat' && filename !== '.' && filename !== '..';
}
