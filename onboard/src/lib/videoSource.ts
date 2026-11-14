const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);
const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

export function isSupportedVideoFile(file: Pick<File, 'name' | 'type'>) {
  const extension = file.name.match(/\.[^.]+$/)?.[0].toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.has(extension ?? '') || SUPPORTED_VIDEO_TYPES.has(file.type.toLowerCase());
}

export function getVideoContainerExtension(file: Pick<File, 'name' | 'type'>) {
  if (file.type.toLowerCase() === 'video/quicktime' || file.name.toLowerCase().endsWith('.mov')) {
    return '.mov';
  }
  return '.mp4';
}
