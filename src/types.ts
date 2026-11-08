export type MediaType = 'image' | 'gif' | 'video';

export type VaultEntry = {
  id: string;
  fileId: string;
  contentType: string;
  mediaType: MediaType;
  sizeBytes: number;
  createdAt: string;
  tags: string[];
  hasPreview: boolean;
  mediaUrl: string;
  previewUrl: string | null;
};

export type DisplayEntry = VaultEntry;

export type UploadFileState = 'pending' | 'uploading' | 'saved' | 'failed' | 'skipped';

export type UploadBatchFile = {
  index: number;
  size: number;
  tags: string[];
  status: UploadFileState;
  progress?: number;
  error?: string;
  entryId?: string;
};

export type UploadBatch = {
  id: string;
  expectedCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes: number;
  files: UploadBatchFile[];
  createdAt: string;
  updatedAt: string;
};
