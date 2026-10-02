import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Folder, Images, LogOut, Maximize2, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { MediaTile } from './components/MediaTile';
import { createCollection, deleteEntry, getConfig, getSession, listCollections, listEntries, login, logout, uploadEntries } from './lib/entries';
import type { DisplayEntry, UploadBatch, UploadFileState, VaultCollection } from './types';

type View = 'search' | 'collections' | 'explore';

export function App() {
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [storageProvider, setStorageProvider] = useState('');

  useEffect(() => {
    async function boot() {
      try {
        const [config, session] = await Promise.all([getConfig(), getSession()]);
        setConfigured(config.configured);
        setAuthenticated(session.authenticated);
        setStorageProvider(config.storageProvider);
      } catch {
        setConfigured(false);
        setAuthenticated(false);
      } finally {
        setChecking(false);
      }
    }

    void boot();
  }, []);

  if (checking) {
    return <StatusGate title="VaultX" message="Loading" />;
  }

  if (!configured) {
    return <SetupGate storageProvider={storageProvider} />;
  }

  if (!authenticated) {
    return <AccessGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <VaultShell onSignedOut={() => setAuthenticated(false)} />;
}

function StatusGate({ title, message }: { title: string; message: string }) {
  return (
    <main className="gate">
      <section className="gate-panel">
        <p className="eyebrow">VaultX</p>
        <h1>{title}</h1>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}

function SetupGate({ storageProvider }: { storageProvider: string }) {
  return (
    <main className="gate">
      <section className="gate-panel">
        <p className="eyebrow">VaultX</p>
        <h1>Config required</h1>
        <p className="muted">Set the server password hash, session secret, and {storageProvider || 'storage'} credentials to continue.</p>
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
      setError('Access denied');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gate">
      <form className="gate-panel" onSubmit={submit}>
        <p className="eyebrow">VaultX</p>
        <h1>This site is locked</h1>
        <p className="muted">Enter the vault password to continue.</p>
        <label>
          <span>Password</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>{loading ? 'Checking' : 'Enter'}</button>
      </form>
    </main>
  );
}

function VaultShell({ onSignedOut }: { onSignedOut: () => void }) {
  const [collections, setCollections] = useState<VaultCollection[]>([]);
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<DisplayEntry | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState('');
  const [view, setView] = useState<View>('search');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refreshEntries() {
    setLoading(true);
    setError('');

    try {
      const nextCollections = await listCollections();
      const nextEntries = await listEntries(nextCollections);
      setCollections(nextCollections);
      setEntries(nextEntries);
    } catch {
      setError('Unable to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshEntries();
  }, []);

  async function createNamedCollection(name: string) {
    const collection = await createCollection(name);
    setCollections((currentCollections) => [collection, ...currentCollections]);
    setActiveCollectionId(collection.id);
    return collection;
  }

  async function signOut() {
    await logout();
    onSignedOut();
  }

  async function removeSelectedEntry(entryId: string) {
    await deleteEntry(entryId);
    setEntries((currentEntries) => currentEntries.filter((entry) => entry.id !== entryId));
    setSelectedEntry(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('search')}>VaultX</button>
        <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}>
          <LogOut size={18} />
        </button>
      </header>

      {error && <p className="status error">{error}</p>}
      {loading && <p className="status">Loading</p>}

      {!loading && view === 'search' && (
        <SearchView
          entries={entries}
          collections={collections}
          activeCollectionId={activeCollectionId}
          onSelectCollection={setActiveCollectionId}
          onSelectEntry={setSelectedEntry}
        />
      )}
      {!loading && view === 'collections' && (
        <CollectionsView
          collections={collections}
          entries={entries}
          activeCollectionId={activeCollectionId}
          onSelectCollection={setActiveCollectionId}
          onCreateCollection={createNamedCollection}
          onUploaded={refreshEntries}
          onOpenCollection={(collectionId) => {
            setActiveCollectionId(collectionId);
            setView('search');
          }}
        />
      )}
      {!loading && view === 'explore' && <ExploreView entries={entries} onSelectEntry={setSelectedEntry} />}

      {selectedEntry && (
        <MediaDetail
          entry={selectedEntry}
          collection={collections.find((collection) => collection.id === selectedEntry.collectionId)}
          onClose={() => setSelectedEntry(null)}
          onDelete={removeSelectedEntry}
        />
      )}

      <nav className="bottom-nav" aria-label="Views">
        <Tab active={view === 'search'} icon={<Search size={20} />} label="Search" onClick={() => setView('search')} />
        <Tab active={view === 'collections'} icon={<Images size={20} />} label="Collections" onClick={() => setView('collections')} />
        <Tab active={view === 'explore'} icon={<Compass size={20} />} label="Explore" onClick={() => setView('explore')} />
      </nav>
    </main>
  );
}

function Tab({ active, icon, label, onClick }: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'tab active' : 'tab'} onClick={onClick} aria-pressed={active} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SearchView({
  entries,
  collections,
  activeCollectionId,
  onSelectCollection,
  onSelectEntry,
}: {
  entries: DisplayEntry[];
  collections: VaultCollection[];
  activeCollectionId: string;
  onSelectCollection: (collectionId: string) => void;
  onSelectEntry: (entry: DisplayEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const matchesCollection = !activeCollectionId || entry.collectionId === activeCollectionId;
      const collectionName = entry.collection?.name || '';
      const matchesQuery = !normalizedQuery
        || entry.displayName.toLowerCase().includes(normalizedQuery)
        || collectionName.toLowerCase().includes(normalizedQuery);

      return matchesCollection && matchesQuery;
    });
  }, [activeCollectionId, entries, normalizedQuery]);

  return (
    <section className="view search-view">
      <div className="searchbar">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search" />
      </div>

      <div className="collection-filter" aria-label="Collection filter">
        <button className={!activeCollectionId ? 'filter-chip active' : 'filter-chip'} onClick={() => onSelectCollection('')} type="button">All</button>
        {collections.map((collection) => (
          <button
            className={activeCollectionId === collection.id ? 'filter-chip active' : 'filter-chip'}
            key={collection.id}
            onClick={() => onSelectCollection(collection.id)}
            type="button"
          >
            {collection.name}
          </button>
        ))}
      </div>

      <div className="grid" aria-live="polite">
        {filtered.map((entry) => (
          <MediaTile key={entry.id} entry={entry} onSelect={onSelectEntry} />
        ))}
      </div>
      {!filtered.length && <p className="status">{entries.length ? 'No results' : 'No media yet'}</p>}
    </section>
  );
}

function CollectionsView({
  collections,
  entries,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onOpenCollection,
  onUploaded,
}: {
  collections: VaultCollection[];
  entries: DisplayEntry[];
  activeCollectionId: string;
  onSelectCollection: (id: string) => void;
  onCreateCollection: (name: string) => Promise<VaultCollection>;
  onOpenCollection: (collectionId: string) => void;
  onUploaded: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState('');

  const counts = useMemo(() => {
    return entries.reduce<Record<string, number>>((currentCounts, entry) => ({
      ...currentCounts,
      [entry.collectionId]: (currentCounts[entry.collectionId] || 0) + 1,
    }), {});
  }, [entries]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await onCreateCollection(name);
      setName('');
    } catch {
      setError('Unable to create collection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="view collections-view">
      <div className="view-header-actions">
        <form className="inline-create" onSubmit={submit}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New collection" aria-label="New collection" />
          <button className="icon-button" type="submit" aria-label="Create collection" title="Create collection" disabled={!name.trim() || saving}>
            <Plus size={18} />
          </button>
        </form>
        <button className={showUpload ? 'secondary active' : 'secondary'} onClick={() => setShowUpload(!showUpload)}>
          <UploadCloud size={18} />
          <span>Upload</span>
        </button>
      </div>

      {error && <p className="status error">{error}</p>}

      {showUpload && (
        <div className="collection-upload-area">
          <UploadView
            collections={collections}
            activeCollectionId={activeCollectionId}
            onSelectCollection={onSelectCollection}
            onCreateCollection={onCreateCollection}
            onUploaded={onUploaded}
          />
        </div>
      )}

      <div className="collection-list">
        {collections.map((collection) => (
          <button className="collection-card" type="button" key={collection.id} onClick={() => onOpenCollection(collection.id)}>
            <span>{collection.name}</span>
            <small>{counts[collection.id] || 0} item{counts[collection.id] === 1 ? '' : 's'}</small>
          </button>
        ))}
      </div>
      {!collections.length && <p className="status">No collections yet</p>}
    </section>
  );
}

function ExploreView({ entries, onSelectEntry }: { entries: DisplayEntry[]; onSelectEntry: (entry: DisplayEntry) => void }) {
  const shuffled = useMemo(() => [...entries].sort(() => Math.random() - 0.5), [entries]);

  return (
    <section className="explore-view" aria-live="polite">
      {shuffled.map((entry) => (
        <article className="stage" key={entry.id}>
          <MediaTile entry={entry} mode="stage" onSelect={onSelectEntry} />
        </article>
      ))}
      {!shuffled.length && <p className="status">No media yet</p>}
    </section>
  );
}

function MediaDetail({
  entry,
  collection,
  onClose,
  onDelete,
}: {
  entry: DisplayEntry;
  collection?: VaultCollection;
  onClose: () => void;
  onDelete: (entryId: string) => Promise<void>;
}) {
  const mediaFrameRef = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function openFullscreen() {
    await mediaFrameRef.current?.requestFullscreen();
  }

  async function removeEntry() {
    setDeleting(true);
    setError('');

    try {
      await onDelete(entry.id);
    } catch {
      setError('Unable to delete');
      setDeleting(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="media-sheet" role="dialog" aria-modal="true" aria-labelledby="media-sheet-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <p className="eyebrow">{collection?.name || 'Collection'}</p>
            <h2 id="media-sheet-title">{entry.displayName}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="detail-media-frame" ref={mediaFrameRef}>
          {entry.objectKind === 'video' ? (
            <video className="detail-media" src={entry.mediaUrl} controls preload="metadata" />
          ) : (
            <img className="detail-media" src={entry.mediaUrl} alt="" />
          )}
        </div>

        <div className="detail-actions">
          <button className="secondary" type="button" onClick={openFullscreen}>
            <Maximize2 size={17} />
            <span>Fullscreen</span>
          </button>
          <button className="secondary danger-button" type="button" onClick={removeEntry} disabled={deleting}>
            <Trash2 size={17} />
            <span>{deleting ? 'Deleting' : 'Delete'}</span>
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}

function UploadView({
  collections,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onUploaded,
}: {
  collections: VaultCollection[];
  activeCollectionId: string;
  onSelectCollection: (collectionId: string) => void;
  onCreateCollection: (name: string) => Promise<VaultCollection>;
  onUploaded: () => Promise<void>;
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [fileProgress, setFileProgress] = useState<Record<number, number>>({});
  const acceptedCount = selectedFiles.filter(isSupportedFile).length;
  const skippedCount = selectedFiles.length - acceptedCount;
  const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);

  async function ensureCollection() {
    if (activeCollectionId) {
      return activeCollectionId;
    }

    if (!newCollectionName.trim()) {
      throw new Error('Choose or create a collection first');
    }

    const collection = await onCreateCollection(newCollectionName.trim());
    setNewCollectionName('');
    return collection.id;
  }

  async function submit() {
    if (!selectedFiles.length) {
      return;
    }

    setLoading(true);
    setError('');
    setFileProgress({});

    try {
      const collectionId = await ensureCollection();
      const finalBatch = await uploadEntries(selectedFiles, collectionId, {
        onBatch: setBatch,
        onFileProgress: (index, progress) => {
          setFileProgress((currentProgress) => ({ ...currentProgress, [index]: progress }));
        },
      });

      if (finalBatch.completedCount !== finalBatch.expectedCount) {
        setError(`${finalBatch.completedCount} of ${finalBatch.expectedCount} accepted files were saved.`);
      } else {
        setSelectedFiles([]);
      }

      await onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(Array.from(event.target.files || []));
    setBatch(null);
    setError('');
  };

  return (
    <section className="view upload-view">
      <div className="upload-panel">
        <label>
          <span>Collection</span>
          <select value={activeCollectionId} onChange={(event) => onSelectCollection(event.target.value)}>
            <option value="">Choose collection</option>
            {collections.map((collection) => (
              <option value={collection.id} key={collection.id}>{collection.name}</option>
            ))}
          </select>
        </label>
        <form className="inline-create" onSubmit={async (event) => {
          event.preventDefault();
          if (newCollectionName.trim()) {
            await onCreateCollection(newCollectionName.trim());
            setNewCollectionName('');
          }
        }}>
          <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="Create collection" aria-label="Create collection" />
          <button className="icon-button" type="submit" aria-label="Create collection" title="Create collection" disabled={!newCollectionName.trim()}>
            <Plus size={18} />
          </button>
        </form>
      </div>

      <div className="upload-controls">
        <label
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            setSelectedFiles(Array.from(event.dataTransfer.files));
            setBatch(null);
            setError('');
          }}
        >
          <UploadCloud size={34} />
          <span>Files</span>
          <input type="file" multiple accept="image/*,video/*" onChange={handleFileChange} />
        </label>

        <label className="dropzone">
          <Folder size={34} />
          <span>Folder</span>
          <input
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory=""
            // @ts-ignore
            directory=""
            onChange={handleFileChange}
          />
        </label>
      </div>

      {!!selectedFiles.length && (
        <div className="upload-summary">
          <strong>{acceptedCount} ready</strong>
          <span>{formatBytes(totalBytes)}</span>
          {!!skippedCount && <span>{skippedCount} unsupported</span>}
        </div>
      )}

      {!!selectedFiles.length && (
        <div className="upload-list">
          {selectedFiles.map((file, index) => {
            const batchFile = batch?.files.find((item) => item.index === index);
            const status = batchFile?.status || (isSupportedFile(file) ? 'pending' : 'skipped');
            const progress = fileProgress[index] || batchFile?.progress || (status === 'saved' ? 100 : 0);

            return (
              <div className="upload-row" key={`${file.name}-${file.size}-${index}`}>
                <div>
                  <p>{file.name}</p>
                  <small>{formatBytes(file.size)} · {statusLabel(status)}</small>
                </div>
                <span className={`upload-badge ${status}`}>{statusLabel(status)}</span>
                <div className="progress-track" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {batch && (
        <p className="status compact-status">
          {batch.completedCount} saved · {batch.failedCount} failed · {batch.skippedCount} skipped
        </p>
      )}
      {error && <p className="status error">{error}</p>}
      <button className="primary" type="button" onClick={submit} disabled={!selectedFiles.length || loading}>
        {loading ? `Uploading ${acceptedCount} item${acceptedCount === 1 ? '' : 's'}` : 'Start upload'}
      </button>
    </section>
  );
}

function isSupportedFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

function statusLabel(status: UploadFileState) {
  if (status === 'saved') {
    return 'Saved';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  if (status === 'skipped') {
    return 'Skipped';
  }
  if (status === 'uploading') {
    return 'Uploading';
  }
  return 'Pending';
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
