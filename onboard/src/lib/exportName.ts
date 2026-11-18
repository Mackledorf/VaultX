export function exportFileName(value: string): string {
  const name = value.trim().replace(/\.mp4$/i, '').trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error('Enter at least one letter or number for the export name.');
  return `${name}.mp4`;
}
