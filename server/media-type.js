import { open } from 'node:fs/promises';

export async function detectMediaType(filePath) {
  const handle = await open(filePath, 'r');
  const header = Buffer.alloc(16);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }

  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mediaType: 'image', contentType: 'image/jpeg' };
  }
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mediaType: 'image', contentType: 'image/png' };
  }
  if (header.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) {
    return { mediaType: 'gif', contentType: 'image/gif' };
  }
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mediaType: 'image', contentType: 'image/webp' };
  }
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mediaType: 'video', contentType: 'video/webm' };
  }
  if (bytesRead >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = header.subarray(8, 12).toString('ascii');
    return brand === 'qt  '
      ? { mediaType: 'video', contentType: 'video/quicktime' }
      : { mediaType: 'video', contentType: 'video/mp4' };
  }

  return null;
}
