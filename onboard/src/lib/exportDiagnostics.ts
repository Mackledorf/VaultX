export function describeFfmpegFailure(
  format: 'mp4',
  exitCode: number | null,
  logs: string[],
  executionError?: string,
) {
  const recentLogs = logs.slice(-200);
  const relevantLines = recentLogs.filter((line) => (
    /error|fail|invalid|not found|unable|cannot|unsupported|could not|conversion failed|palette/i.test(line)
  ));
  const details = [...relevantLines.slice(-2), ...(executionError ? [executionError] : [])]
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(-240))
    .filter((line, index, lines) => line && lines.indexOf(line) === index)
    .slice(-2);
  const detailSuffix = details.length ? ` Details: ${details.join(' | ')}` : '';
  const diagnosticText = [...recentLogs, executionError ?? ''].join('\n');

  if (/cannot allocate memory|out of memory|memory allocation failed|allocation failed|memory access out of bounds/i.test(diagnosticText)) {
    return `The browser ran out of memory while encoding this ${format.toUpperCase()}. Try a smaller crop or resolution, or close other tabs and retry.${detailSuffix}`;
  }
  if (/moov atom not found|invalid data found when processing input|could not find codec parameters|error opening input|error while decoding|unsupported codec|decoder.{0,30}(not found|unsupported)|could not open codec/i.test(diagnosticText)) {
    return `FFmpeg could not decode the source video. The file may be damaged or use a codec this browser encoder cannot read; this points to source decoding, not a trim-length limit.${detailSuffix}`;
  }
  if (/error initializing filter|error reinitializing filters|failed to configure output pad|error parsing filter|no such filter|error applying option|invalid.*(?:filter|crop|size|width|height|argument)/i.test(diagnosticText)) {
    return `FFmpeg could not apply the current crop or image adjustments. Reset the crop or adjustments and retry; the diagnostic points to the edit filter setup.${detailSuffix}`;
  }

  const codeSuffix = exitCode === null ? '' : ` (FFmpeg exit code ${exitCode})`;
  return `${format.toUpperCase()} encoding failed${codeSuffix}. The available diagnostics do not identify a source-decode or filter-setup failure, so this alone does not establish that the video is damaged.${detailSuffix}`;
}
