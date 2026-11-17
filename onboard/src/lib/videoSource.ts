const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.gif']);
const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'image/gif']);

export function isSupportedVideoFile(file: Pick<File, 'name' | 'type'>) {
  const extension = file.name.match(/\.[^.]+$/)?.[0].toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.has(extension ?? '') || SUPPORTED_VIDEO_TYPES.has(file.type.toLowerCase());
}

export function isGifFile(file: Pick<File, 'name' | 'type'>) {
  const type = file.type.toLowerCase();
  if (type === 'image/gif') return true;
  if (SUPPORTED_VIDEO_TYPES.has(type)) return false;
  return file.name.toLowerCase().endsWith('.gif');
}

export function isSupportedStitchFile(file: Pick<File, 'name' | 'type'>) {
  return isSupportedVideoFile(file) && !isGifFile(file) && getVideoContainerExtension(file) !== '.webm';
}

export function getVideoContainerExtension(file: Pick<File, 'name' | 'type'>) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'video/quicktime') return '.mov';
  if (type === 'video/webm') return '.webm';
  if (type === 'image/gif') return '.gif';
  if (name.endsWith('.mov')) return '.mov';
  if (name.endsWith('.webm')) return '.webm';
  if (name.endsWith('.gif')) return '.gif';
  return '.mp4';
}
