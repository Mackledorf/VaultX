import type { LocalDirectoryHandle } from './local-vault';

export type ImportSource = { file: File; path: string };
export type SourceCollection = { files: ImportSource[]; errors: string[] };

type DropItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };

type CapturedItem = {
  handle?: Promise<{ value: FileSystemHandle | null; error?: unknown }>;
  entry: FileSystemEntry | null;
  file: File | null;
};

export function captureDrop(data: DataTransfer): CapturedItem[] {
  return Array.from(data.items).filter((item) => item.kind === 'file').map((item) => {
    const handle = (item as DropItem).getAsFileSystemHandle?.();
    return {
      handle: handle?.then((value) => ({ value }), (error: unknown) => ({ value: null, error })),
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile(),
    };
  });
}

export async function collectDrop(items: CapturedItem[]): Promise<SourceCollection> {
  const result: SourceCollection = { files: [], errors: [] };
  async function visitHandle(handle: FileSystemHandle, path: string): Promise<void> {
    try {
      if (handle.kind === 'file') {
        result.files.push({ file: await (handle as FileSystemFileHandle).getFile(), path });
      } else {
        for await (const child of (handle as LocalDirectoryHandle).values()) await visitHandle(child, `${path}/${child.name}`);
      }
    } catch (error) {
      result.errors.push(`${path}: ${error instanceof Error ? error.message : 'Could not read entry.'}`);
    }
  }
  async function visitEntry(entry: FileSystemEntry, path: string): Promise<void> {
    try {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        result.files.push({ file, path });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let entries: FileSystemEntry[];
        do {
          entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of entries) await visitEntry(child, `${path}/${child.name}`);
        } while (entries.length);
      } else {
        result.errors.push(`${path}: Unsupported entry.`);
      }
    } catch (error) {
      result.errors.push(`${path}: ${error instanceof Error ? error.message : 'Could not read entry.'}`);
    }
  }
  for (const item of items) {
    try {
      const handle = item.handle ? await item.handle : undefined;
      if (handle?.value) await visitHandle(handle.value, handle.value.name);
      else if (item.entry) await visitEntry(item.entry, item.entry.name);
      else if (item.file) result.files.push({ file: item.file, path: item.file.name });
      else result.errors.push(handle?.error instanceof Error ? handle.error.message : 'A dropped item could not be read. Use the file or folder picker instead.');
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'A dropped item could not be read.');
    }
  }
  return result;
}
