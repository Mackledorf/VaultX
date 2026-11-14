export type VideoDimensions = { width: number; height: number };

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

export function buildStitchFilter(width: number, height: number, inputCount: number) {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 2 || height < 2 || inputCount < 2
  ) {
    throw new Error('Stitch dimensions and source count are invalid.');
  }

  const clipFilters = Array.from({ length: inputCount }, (_, index) => (
    `[${index}:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`
  ));
  const inputs = Array.from({ length: inputCount }, (_, index) => `[v${index}]`).join('');
  clipFilters.push(`${inputs}concat=n=${inputCount}:v=1:a=0[outv]`);
  return clipFilters.join(';');
}
