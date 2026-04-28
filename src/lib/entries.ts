import { supabase } from './supabase';
import type { DisplayEntry, VaultEntry } from '../types';

const BUCKET = 'vaultx';
const URL_TTL_SECONDS = 60 * 30;

export async function listEntries(): Promise<DisplayEntry[]> {
  const { data, error } = await supabase
    .from('vault_entries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return attachUrls((data || []) as VaultEntry[]);
}

export async function uploadEntries(files: File[], userId: string): Promise<void> {
  for (const file of files) {
    const id = crypto.randomUUID();
    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const objectPath = `${userId}/${id}.${extension}`;
    const objectKind = file.type.startsWith('video/') ? 'video' : 'image';

    const uploadResult = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

    if (uploadResult.error) {
      throw uploadResult.error;
    }

    const insertResult = await supabase.from('vault_entries').insert({
      id,
      owner_id: userId,
      object_path: objectPath,
      display_name: file.name,
      content_type: file.type,
      object_kind: objectKind,
      keywords: keywordsFromName(file.name),
    });

    if (insertResult.error) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      throw insertResult.error;
    }
  }
}

async function attachUrls(entries: VaultEntry[]): Promise<DisplayEntry[]> {
  if (!entries.length) {
    return [];
  }

  const paths = entries.map((entry) => entry.object_path);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL_SECONDS);

  if (error) {
    throw error;
  }

  const urlsByPath = new Map((data || []).map((item) => [item.path, item.signedUrl]));

  return entries
    .map((entry) => ({
      ...entry,
      signedUrl: urlsByPath.get(entry.object_path) || '',
    }))
    .filter((entry) => entry.signedUrl);
}

function keywordsFromName(name: string): string[] {
  return name
    .replace(/\.[^.]+$/, '')
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}
