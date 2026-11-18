export async function runWithSeekFallback(
  execute: (seek: boolean) => Promise<number>,
  getSeekFailure: () => string,
  onFallback: (reason: string) => void,
) {
  const result = await execute(true);
  const failure = getSeekFailure();
  if (!failure) return result;
  onFallback(failure);
  return execute(false);
}
