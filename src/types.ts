export type ObjectKind = 'image' | 'video';

export type VaultCollection = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  coverEntryId: string | null;
};

export type VaultEntry = {
  id: string;
  collectionId: string;
  fileId: string;
  displayName: string;
  contentType: string;
  objectKind: ObjectKind;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  mediaUrl: string;
};

export type DisplayEntry = VaultEntry & {
  collection?: VaultCollection;
};

export type UploadFileState = 'pending' | 'uploading' | 'saved' | 'failed' | 'skipped';

export type UploadBatchFile = {
  index: number;
  name: string;
  size: number;
  type: string;
  status: UploadFileState;
  progress?: number;
  error?: string;
  entryId?: string;
};

export type UploadBatch = {
  id: string;
  collectionId: string;
  expectedCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes: number;
  files: UploadBatchFile[];
  createdAt: string;
  updatedAt: string;
};
