export type VaultEntry = {
  id: string;
  owner_id: string;
  object_path: string;
  display_name: string;
  content_type: string;
  object_kind: 'image' | 'video';
  keywords: string[] | null;
  created_at: string;
};

export type DisplayEntry = VaultEntry & {
  signedUrl: string;
};
