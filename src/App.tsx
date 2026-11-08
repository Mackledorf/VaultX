import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Film, FolderOpen, LogOut, Search, Trash2, Upload, X } from 'lucide-react';
import { MediaTile } from './components/MediaTile';
import { deleteEntry, getConfig, getSession, login, logout, searchEntries, updateEntryTags, uploadEntries } from './lib/entries';
import type { DisplayEntry, MediaType, UploadBatch, UploadFileState } from './types';

type MediaFilter = MediaType | 'all';

export function App() {
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [storageProvider, setStorageProvider] = useState('');
  const [authDisabled, setAuthDisabled] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getConfig(), getSession()])
      .then(([config, session]) => {
        if (active) {
          setConfigured(config.configured);
          setAuthenticated(session.authenticated);
          setStorageProvider(config.storageProvider);
          setAuthDisabled(config.authDisabled);
        }
      })
      .catch(() => {
        if (active) {
          setConfigured(false);
          setAuthenticated(false);
        }
      })
      .finally(() => {
        if (active) {
          setChecking(false);
        }
      });
    return () => { active = false; };
  }, []);

  if (checking) {
    return <StatusGate message="Opening your private library" />;
  }
  if (!configured) {
    return <SetupGate storageProvider={storageProvider} />;
  }
  if (!authenticated) {
    return <AccessGate onAuthenticated={() => setAuthenticated(true)} />;
  }
  return <VaultShell authDisabled={authDisabled} onSignedOut={() => setAuthenticated(false)} />;
}

function StatusGate({ message }: { message: string }) {
  return <main className="gate"><p className="brand-word">Vault<span>X</span></p><p className="muted">{message}</p></main>;
}

function SetupGate({ storageProvider }: { storageProvider: string }) {
  return (
    <main className="gate">
      <section className="gate-panel">
        <p className="brand-word">Vault<span>X</span></p>
        <h1>Finish setup</h1>
        <p className="muted">Set a vault password and session secret, then configure {storageProvider || 'local'} storage on the server.</p>
      </section>
    </main>
  );
}

function AccessGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(password);
      setPassword('');
      onAuthenticated();
    } catch {
      setError('Access denied. Check your password and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gate">
      <form className="gate-panel" onSubmit={submit}>
        <p className="brand-word">Vault<span>X</span></p>
        <h1>Your library, private.</h1>
        <p className="muted">Enter your vault password to continue.</p>
        <label className="field-label">Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>{loading ? 'Checking…' : 'Unlock vault'}</button>
      </form>
    </main>
  );
}

function VaultShell({ authDisabled, onSignedOut }: { authDisabled: boolean; onSignedOut: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<DisplayEntry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      searchEntries(query, filter)
        .then((result) => {
          if (active) {
            setEntries(result.items);
            setTotal(result.total);
          }
        })
        .catch(() => {
          if (active) {
            setError('Could not load media. Check your connection and try again.');
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, filter, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await searchEntries(query, filter, entries.length);
      setEntries((current) => [...current, ...result.items]);
      setTotal(result.total);
    } catch {
      setError('Could not load more media.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function signOut() {
    await logout();
    onSignedOut();
  }

  async function removeEntry(entryId: string) {
    await deleteEntry(entryId);
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    setTotal((current) => Math.max(0, current - 1));
    setSelectedEntry(null);
  }

  async function saveTags(entryId: string, tags: string[]) {
    const updated = await updateEntryTags(entryId, tags);
    setEntries((current) => current.map((entry) => entry.id === entryId ? updated : entry));
    setSelectedEntry(updated);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { setQuery(''); setFilter('all'); }} aria-label="VaultX home">
          <span className="brand-word">Vault<span>X</span></span>
        </button>
        <div className="topbar-actions">
          <button className="upload-trigger" type="button" onClick={() => setUploadOpen(true)}><Upload size={17} /><span>Upload</span></button>
          {!authDisabled && <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={18} /></button>}
        </div>
      </header>

      <section className="search-section">
        <form className="searchbar" onSubmit={(event) => event.preventDefault()} role="search">
          <Search size={21} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search VaultX" aria-label="Search media by tags" />
          {query && <button className="clear-search" type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17} /></button>}
        </form>
        <div className="filter-row">
          <div className="segmented-control" role="group" aria-label="Filter media type">
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All media</FilterButton>
            <FilterButton active={filter === 'image'} onClick={() => setFilter('image')}>Images</FilterButton>
            <FilterButton active={filter === 'gif'} onClick={() => setFilter('gif')}>GIFs</FilterButton>
            <FilterButton active={filter === 'video'} onClick={() => setFilter('video')}>Videos</FilterButton>
          </div>
          {(query.trim() || filter !== 'all') && <span className="result-count">{loading ? 'Searching…' : `${total.toLocaleString()} results`}</span>}
        </div>
      </section>

      <section className="results-section" aria-live="polite">
        {error && <p className="inline-error">{error}</p>}
        {loading && !entries.length && Boolean(query) && <div className="loading-state">Searching…</div>}
        {!loading && !!entries.length && Boolean(query.trim()) && (
          <p className="search-context">Results for <strong>“{query.trim()}”</strong></p>
        )}
        {!loading && !entries.length && Boolean(query) && (
          <div className="empty-state">
            <h2>No results</h2>
            <p>Try another tag or clear the search.</p>
          </div>
        )}
        {!!entries.length && (
          <div className="media-grid">
            {entries.map((entry) => <MediaTile key={entry.id} entry={entry} onSelect={setSelectedEntry} />)}
          </div>
        )}
        {entries.length < total && <button className="load-more" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
      </section>

      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} onUploaded={() => setRefreshKey((current) => current + 1)} />}
      {selectedEntry && <MediaDetail entry={selectedEntry} onClose={() => setSelectedEntry(null)} onDelete={removeEntry} onSaveTags={saveTags} />}
    </main>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={active ? 'filter-option active' : 'filter-option'} type="button" aria-pressed={active} onClick={onClick}>{children}</button>;
}

type UploadStage = 'select' | 'tag' | 'review' | 'confirm' | 'uploading';

type UploadDraftItem = {
  id: string;
  file: File;
  relativePath: string;
  tags: string[];
  previewUrl: string | null;
  uploadStatus?: UploadFileState;
  uploadError?: string;
};

const MAX_UPLOAD_ITEMS = 100;
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const ACCEPTED_MEDIA = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const [items, setItems] = useState<UploadDraftItem[]>([]);
  const [stage, setStage] = useState<UploadStage>('select');
  const [tagReturnStage, setTagReturnStage] = useState<'select' | 'review'>('select');
  const [activeIndex, setActiveIndex] = useState(0);
  const [tagInput, setTagInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [progress, setProgress] = useState<Record<number, number>>({});
  const isUploading = stage === 'uploading';
  const oversizedCount = items.filter((item) => item.file.size > MAX_UPLOAD_BYTES).length;
  const activeItem = items[activeIndex];

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isUploading) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isUploading, onClose]);

  function createDraftItem(file: File): UploadDraftItem {
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    if (previewUrl) previewUrls.current.add(previewUrl);
    return {
      id: crypto.randomUUID(),
      file,
      relativePath: file.webkitRelativePath || file.name,
      tags: [],
      previewUrl,
    };
  }

  function chooseFiles(files: File[]) {
    if (!files.length) return;
    if (items.length + files.length > MAX_UPLOAD_ITEMS) {
      setError(`This would make ${items.length + files.length} items. A batch can contain up to ${MAX_UPLOAD_ITEMS}; remove some items before adding this selection.`);
      return;
    }
    setItems((current) => [...current, ...files.map(createDraftItem)]);
    setBatch(null);
    setProgress({});
    setError('');
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    chooseFiles(Array.from(event.currentTarget.files || []));
    event.currentTarget.value = '';
  }

  function revokeItemPreview(item: UploadDraftItem) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrls.current.delete(item.previewUrl);
    }
  }

  function removeItem(itemId: string) {
    const removed = items.find((item) => item.id === itemId);
    if (removed) revokeItemPreview(removed);
    const nextItems = items.filter((item) => item.id !== itemId);
    setItems(nextItems);
    setError('');
    if (!nextItems.length) {
      setStage('select');
      setActiveIndex(0);
      setTagInput('');
      return;
    }
    if (activeIndex >= nextItems.length) setActiveIndex(nextItems.length - 1);
  }

  function startTagging() {
    if (!items.length) {
      setError('Choose at least one file or folder.');
      return;
    }
    if (oversizedCount) {
      setError(`${oversizedCount} item${oversizedCount === 1 ? '' : 's'} exceed the 150 MB limit. Remove them to continue.`);
      return;
    }
    const firstUntaggedIndex = items.findIndex((item) => !item.tags.length);
    if (firstUntaggedIndex < 0) {
      setStage('review');
      return;
    }
    setTagReturnStage('select');
    setActiveIndex(firstUntaggedIndex);
    setTagInput(items[firstUntaggedIndex].tags.join(', '));
    setError('');
    setStage('tag');
  }

  function saveActiveTags(tags: string[]) {
    setItems((current) => current.map((item, index) => index === activeIndex ? { ...item, tags } : item));
  }

  function goPreviousTag() {
    saveActiveTags(parseTags(tagInput));
    if (activeIndex === 0) {
      setStage(tagReturnStage);
      return;
    }
    const previousIndex = activeIndex - 1;
    setActiveIndex(previousIndex);
    setTagInput(items[previousIndex].tags.join(', '));
    setError('');
  }

  function goNextTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tags = parseTags(tagInput);
    if (!tags.length) {
      setError('Add at least one tag for this item.');
      return;
    }
    const nextItems = items.map((item, index) => index === activeIndex ? { ...item, tags } : item);
    setItems(nextItems);
    setError('');
    if (activeIndex < items.length - 1) {
      const nextIndex = activeIndex + 1;
      setActiveIndex(nextIndex);
      setTagInput(nextItems[nextIndex].tags.join(', '));
    } else {
      setStage('review');
    }
  }

  function editItemTags(index: number) {
    setTagReturnStage('review');
    setActiveIndex(index);
    setTagInput(items[index].tags.join(', '));
    setError('');
    setStage('tag');
  }

  async function submit() {
    if (!items.length || oversizedCount || items.some((item) => !item.tags.length)) {
      setStage(items.some((item) => !item.tags.length) ? 'tag' : 'review');
      setError('Complete tags for every item and remove files over 150 MB before adding them.');
      return;
    }

    setStage('uploading');
    setError('');
    setProgress({});
    setItems((current) => current.map(({ uploadStatus: _status, uploadError: _error, ...item }) => item));
    try {
      const result = await uploadEntries(items.map(({ file, tags }) => ({ file, tags })), {
        onBatch: setBatch,
        onFileProgress: (index, value) => setProgress((current) => ({ ...current, [index]: value })),
      });
      if (result.completedCount > 0) onUploaded();
      if (result.failedCount || result.skippedCount) {
        const remainingItems = items.flatMap((item, index) => {
          const uploadFile = result.files[index];
          if (uploadFile?.status === 'saved') return [];
          return [{
            ...item,
            uploadStatus: uploadFile?.status || 'failed',
            uploadError: uploadFile?.error || 'Upload did not complete.',
          }];
        });
        items.forEach((item, index) => {
          if (result.files[index]?.status === 'saved') revokeItemPreview(item);
        });
        setItems(remainingItems);
        setBatch(null);
        setProgress({});
        setStage('review');
        setError(`${result.completedCount} saved, ${result.failedCount} failed, ${result.skippedCount} skipped. Review the remaining items and retry.`);
        return;
      }
      onClose();
    } catch (uploadError) {
      setStage('review');
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed. Review the items and try again.');
    }
  }

  function renderPreview(item: UploadDraftItem, large = false) {
    if (item.previewUrl) {
      return <img className={large ? 'draft-preview-image large' : 'draft-preview-image'} src={item.previewUrl} alt="Local upload preview" />;
    }
    if (item.file.type.startsWith('video/')) {
      return <div className={large ? 'draft-video-preview large' : 'draft-video-preview'}><Film size={large ? 30 : 18} /><span>VIDEO</span></div>;
    }
    return <div className={large ? 'draft-video-preview large' : 'draft-video-preview'}><span>{fileCategory(item.file)}</span></div>;
  }

  function renderSelectedItems() {
    if (!items.length) return null;
    return (
      <div className="draft-list" aria-label="Selected items">
        {items.map((item, index) => (
          <article className="draft-row" key={item.id}>
            <div className="draft-thumb">{renderPreview(item)}</div>
            <div className="draft-row-info">
              <strong title={item.relativePath}>{item.relativePath}</strong>
              <small>{formatBytes(item.file.size)} · {fileCategory(item.file)} · {item.tags.length ? `${item.tags.length} tags` : 'Needs tags'}</small>
            </div>
            {!isUploading && <button className="remove-file" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => removeItem(item.id)}><X size={15} /></button>}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isUploading) onClose(); }}>
      <section className="upload-dialog upload-wizard" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Add to your library</p>
            <h2 id="upload-title">{stage === 'confirm' ? `Add ${items.length} items?` : stage === 'tag' ? 'Tag each item' : stage === 'review' ? 'Review items' : stage === 'uploading' ? 'Adding items' : 'Choose media'}</h2>
            <p className="wizard-step">{stage === 'select' ? '1 · Select' : stage === 'tag' ? `2 · Tag ${activeIndex + 1} of ${items.length}` : stage === 'review' ? '3 · Review' : stage === 'confirm' ? '4 · Confirm' : 'Uploading'}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close upload" onClick={onClose} disabled={isUploading}><X size={19} /></button>
        </header>

        {stage === 'select' && (
          <>
            <input className="visually-hidden" ref={fileInputRef} type="file" multiple accept={ACCEPTED_MEDIA} onChange={handleFileSelection} />
            <input className="visually-hidden" ref={folderInputRef} type="file" multiple accept={ACCEPTED_MEDIA} onChange={handleFileSelection} />
            <div
              className={dragging ? 'dropzone dragging' : 'dropzone'}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFiles(Array.from(event.dataTransfer.files)); }}
            >
              <span className="drop-icon"><Upload size={20} /></span>
              <strong>Drop media here</strong>
              <small>JPEG, PNG, WebP, GIF, MP4, WebM, MOV · up to 150 MB each · 100 items per batch</small>
              <div className="picker-actions">
                <button className="secondary" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={16} />Choose files</button>
                <button className="secondary" type="button" onClick={() => folderInputRef.current?.click()}><FolderOpen size={16} />Choose folder</button>
              </div>
            </div>
            {!!items.length && <div className="draft-summary"><strong>{items.length} / {MAX_UPLOAD_ITEMS} items</strong><span>{formatBytes(items.reduce((total, item) => total + item.file.size, 0))}</span></div>}
            {renderSelectedItems()}
            {error && <p className="inline-error">{error}</p>}
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="primary" type="button" onClick={startTagging} disabled={!items.length}>
                {items.every((item) => item.tags.length > 0) ? 'Review items' : 'Tag items'}
              </button>
            </div>
          </>
        )}

        {stage === 'tag' && activeItem && (
          <>
            <div className="tagging-layout">
              <div className="tagging-preview">{renderPreview(activeItem, true)}</div>
              <form className="tagging-form" onSubmit={goNextTag}>
                <p className="draft-filename" title={activeItem.relativePath}>{activeItem.relativePath}</p>
                <p className="muted">{fileCategory(activeItem.file)} · {formatBytes(activeItem.file.size)}</p>
                <label className="field-label">Tags <span>Required · separate with commas</span>
                  <input autoFocus value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="e.g. coast, weekend" />
                </label>
                {!!parseTags(tagInput).length && <div className="tag-chips">{parseTags(tagInput).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                {error && <p className="inline-error">{error}</p>}
                <div className="tag-navigation">
                  <button className="secondary" type="button" onClick={goPreviousTag}><ArrowLeft size={16} />{activeIndex === 0 ? 'Back' : 'Previous'}</button>
                  <button className="primary" type="submit">{activeIndex === items.length - 1 ? 'Review items' : 'Next item'}<ArrowRight size={16} /></button>
                </div>
              </form>
            </div>
          </>
        )}

        {stage === 'review' && (
          <>
            <p className="muted review-intro">Check each preview and its tags before adding.</p>
            <div className="review-list" aria-label="Review selected media">
              {items.map((item, index) => (
                <article className="review-row" key={item.id}>
                  <div className="draft-thumb">{renderPreview(item)}</div>
                  <div className="draft-row-info">
                    <strong title={item.relativePath}>{item.relativePath}</strong>
                    <small>{formatBytes(item.file.size)} · {fileCategory(item.file)}</small>
                    <div className="tag-chips compact">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    {item.uploadError && <small className="draft-row-error">{statusLabel(item.uploadStatus || 'failed')}: {item.uploadError}</small>}
                  </div>
                  <div className="review-actions">
                    <button className="review-edit" type="button" onClick={() => editItemTags(index)}>Edit</button>
                    <button className="remove-file" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => removeItem(item.id)}><X size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
            {error && <p className="inline-error">{error}</p>}
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setStage('select')}><ArrowLeft size={16} />Add more</button>
              <button className="primary" type="button" disabled={!items.length || oversizedCount > 0} onClick={() => { setError(''); setStage('confirm'); }}>Continue</button>
            </div>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <p className="confirm-copy">Ready to add these {items.length} items to your vault?</p>
            <div className="confirm-summary">
              <span>{items.length} items</span>
              <span>{formatBytes(items.reduce((total, item) => total + item.file.size, 0))}</span>
            </div>
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setStage('review')}><ArrowLeft size={16} />Go back</button>
              <button className="primary" type="button" onClick={submit} disabled={!items.length || oversizedCount > 0}>Add {items.length} items</button>
            </div>
          </>
        )}

        {stage === 'uploading' && (
          <>
            <p className="muted">Your confirmed items are being added.</p>
            <div className="upload-items" aria-live="polite">
              {items.map((item, index) => {
                const batchFile = batch?.files.find((file) => file.index === index);
                const status = batchFile?.status || 'pending';
                const percent = progress[index] ?? batchFile?.progress ?? 0;
                return <div className="upload-row" key={item.id}>
                  <div className="draft-thumb">{renderPreview(item)}</div>
                  <div className="upload-item-info">
                    <strong title={item.relativePath}>{item.relativePath}</strong>
                    <small>{formatBytes(item.file.size)} · {statusLabel(status)}</small>
                    <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
                  </div>
                </div>;
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MediaDetail({ entry, onClose, onDelete, onSaveTags }: {
  entry: DisplayEntry;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onSaveTags: (id: string, tags: string[]) => Promise<void>;
}) {
  const [tagInput, setTagInput] = useState(entry.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSaveTags(entry.id, parseTags(tagInput));
    } catch {
      setError('Could not save tags.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Permanently delete this media from your vault?')) return;
    setDeleting(true);
    try {
      await onDelete(entry.id);
    } catch {
      setError('Could not delete this media.');
      setDeleting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header className="dialog-header">
          <div><p className="eyebrow">{entry.mediaType} · {formatBytes(entry.sizeBytes)}</p><h2 id="detail-title">Media details</h2></div>
          <button className="icon-button" type="button" aria-label="Close details" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="detail-media-frame">
          {entry.mediaType === 'video'
            ? <video className="detail-media" src={entry.mediaUrl} controls playsInline preload="metadata" />
            : <img className="detail-media" src={entry.mediaUrl} alt={entry.tags.join(', ')} />}
        </div>
        <label className="field-label">Tags <span>Comma separated</span>
          <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="Add tags" />
        </label>
        {error && <p className="inline-error">{error}</p>}
        <div className="dialog-actions">
          <button className="delete-action" type="button" onClick={remove} disabled={deleting}><Trash2 size={16} />{deleting ? 'Deleting…' : 'Delete'}</button>
          <button className="primary" type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save tags'}</button>
        </div>
      </section>
    </div>
  );
}

function parseTags(value: string) {
  return value.split(/[\n,;]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 30);
}

function fileCategory(file: File) {
  if (file.type === 'image/gif') return 'GIF';
  if (file.type.startsWith('video/')) return 'VIDEO';
  return 'IMAGE';
}

function statusLabel(status: string) {
  if (status === 'saved') return 'saved';
  if (status === 'failed' || status === 'skipped') return status;
  if (status === 'uploading') return 'uploading';
  return 'ready';
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
