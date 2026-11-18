export function buildStreamRemuxArgs(hasSeparateAudio: boolean) {
  return [
    '-copyts',
    '-i', 'video-input',
    ...(hasSeparateAudio ? ['-i', 'audio-input'] : []),
    '-map', '0:v:0', '-map', hasSeparateAudio ? '1:a:0' : '0:a:0?',
    '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'output.mp4',
  ];
}
