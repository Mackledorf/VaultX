export type VideoDimensions = { width: number; height: number };
export type StitchClip = { duration: number; hasAudio: boolean };

export function getStitchOutputDimensions(dimensions: VideoDimensions[]) {
  const largestSource = dimensions.reduce<VideoDimensions | null>((largest, current) => {
    if (!Number.isFinite(current.width) || !Number.isFinite(current.height) || current.width < 2 || current.height < 2) {
      throw new Error('Could not read the dimensions of every video selected for stitching.');
    }
    return !largest || current.width * current.height > largest.width * largest.height ? current : largest;
  }, null);
  if (!largestSource) throw new Error('Could not read the dimensions of every video selected for stitching.');

  return {
    width: Math.max(2, Math.floor(largestSource.width / 2) * 2),
    height: Math.max(2, Math.floor(largestSource.height / 2) * 2),
  };
}

export function buildStitchFilter(width: number, height: number, clips: StitchClip[]) {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 2 || height < 2 || clips.length < 2 ||
    clips.some((clip) => !Number.isFinite(clip.duration) || clip.duration <= 0)
  ) {
    throw new Error('Stitch dimensions and source count are invalid.');
  }

  const clipFilters = clips.map((_clip, index) => (
    `[${index}:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`
  ));
  const hasAudio = clips.some((clip) => clip.hasAudio);
  if (hasAudio) {
    clips.forEach((clip, index) => {
      const input = clip.hasAudio
        ? `[${index}:a:0]aresample=48000:async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,apad`
        : 'anullsrc=channel_layout=stereo:sample_rate=48000';
      clipFilters.push(`${input},atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`);
    });
  }
  const inputs = clips.map((_clip, index) => `[v${index}]${hasAudio ? `[a${index}]` : ''}`).join('');
  clipFilters.push(`${inputs}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[outv]${hasAudio ? '[outa]' : ''}`);
  return clipFilters.join(';');
}
