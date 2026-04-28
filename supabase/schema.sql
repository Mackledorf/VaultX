create extension if not exists pgcrypto;

create table if not exists public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  display_name text not null,
  content_type text not null,
  object_kind text not null check (object_kind in ('image', 'video')),
  keywords text[] default '{}',
  created_at timestamptz not null default now()
);

alter table public.vault_entries enable row level security;

create policy "select own entries"
on public.vault_entries for select
to authenticated
using (auth.uid() = owner_id);

create policy "insert own entries"
on public.vault_entries for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "delete own entries"
on public.vault_entries for delete
to authenticated
using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vaultx',
  'vaultx',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;

create policy "read own objects"
on storage.objects for select
to authenticated
using (bucket_id = 'vaultx' and owner = auth.uid());

create policy "insert own objects"
on storage.objects for insert
to authenticated
with check (bucket_id = 'vaultx' and owner = auth.uid() and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own objects"
on storage.objects for delete
to authenticated
using (bucket_id = 'vaultx' and owner = auth.uid());
