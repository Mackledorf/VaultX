export type BatchStatus = 'pending' | 'saved' | 'failed' | 'attention';
export type BatchResult = { status: BatchStatus; detail?: string; pause?: boolean };

export async function executeBatch<T extends { status: BatchStatus }>(
  items: T[],
  run: (item: T) => Promise<BatchResult>,
  report: (item: T, result: BatchResult) => void,
): Promise<boolean> {
  for (const item of items) {
    if (item.status !== 'pending' && item.status !== 'failed') continue;
    const result = await run(item);
    report(item, result);
    if (result.pause) return true;
  }
  return false;
}
