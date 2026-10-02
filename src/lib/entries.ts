import type { DisplayEntry, UploadBatch, VaultCollection, VaultEntry } from '../types';

type UploadCallbacks = {
  onBatch?: (batch: UploadBatch) => void;
  onFileProgress?: (index: number, progress: number) => void;
  onFileStatus?: (index: number, status: string, error?: string) => void;
};

export async function getConfig(): Promise<{ configured: boolean; storageProvider: string; maxFileSizeBytes: number }> {
  return request('/api/config');
}

export async function getSession(): Promise<{ authenticated: boolean; configured: boolean }> {
  return request('/api/session');
}

export async function login(password: string): Promise<void> {
  await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await request('/api/logout', { method: 'POST' });
}

export async function listEntries(collections: VaultCollection[] = []): Promise<DisplayEntry[]> {
  const entries = await request<VaultEntry[]>('/api/entries');
  const collectionsById = new Map(collections.map((collection) => [collection.id, collection]));

  return entries.map((entry) => ({
    ...entry,
    collection: collectionsById.get(entry.collectionId),
  }));
}

export async function listCollections(): Promise<VaultCollection[]> {
  return request('/api/collections');
}

export async function createCollection(name: string): Promise<VaultCollection> {
  return request('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteEntry(entryId: string): Promise<void> {
  await request(`/api/entries/${entryId}`, { method: 'DELETE' });
}

export async function uploadEntries(files: File[], collectionId: string, callbacks: UploadCallbacks = {}): Promise<UploadBatch> {
  const batch = await request<UploadBatch>('/api/upload-batches', {
    method: 'POST',
    body: JSON.stringify({
      collectionId,
      files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
    }),
  });
  callbacks.onBatch?.(batch);

  const acceptedFiles = batch.files.filter((file) => file.status !== 'skipped');
  await runWithConcurrency(acceptedFiles, 2, async (batchFile) => {
    const file = files[batchFile.index];

    if (!file) {
      return;
    }

    try {
      callbacks.onFileStatus?.(batchFile.index, 'uploading');
      const nextBatch = await uploadBatchFile(batch.id, batchFile.index, file, callbacks.onFileProgress);
      callbacks.onBatch?.(nextBatch);
    } catch {
      callbacks.onFileStatus?.(batchFile.index, 'failed', 'Upload failed');
    }
  });

  const finalBatch = await request<UploadBatch>(`/api/upload-batches/${batch.id}`);
  callbacks.onBatch?.(finalBatch);

  return finalBatch;
}

async function uploadBatchFile(
  batchId: string,
  index: number,
  file: File,
  onProgress?: (index: number, progress: number) => void,
): Promise<UploadBatch> {
  const formData = new FormData();
  formData.append('index', String(index));
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/upload-batches/${batchId}/files`);
    request.withCredentials = true;

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(index, Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const payload = JSON.parse(request.responseText) as { batch: UploadBatch };
        resolve(payload.batch);
      } else {
        reject(new Error('Upload failed'));
      }
    };

    request.onerror = () => reject(new Error('Upload failed'));
    request.send(formData);
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function readError(response: Response) {
  try {
    const payload = await response.json();
    return payload.error || 'Request failed';
  } catch {
    return 'Request failed';
  }
}
