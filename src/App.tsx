import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Compass, LogOut, Search, UploadCloud } from 'lucide-react';
import type { Session, User } from '@supabase/supabase-js';
import { MediaTile } from './components/MediaTile';
import { listEntries, uploadEntries } from './lib/entries';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { DisplayEntry } from './types';

type View = 'search' | 'explore' | 'upload';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>('search');

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user || null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) {
    return <SetupGate />;
  }

  if (!session || !user) {
    return <AccessGate />;
  }

  return (
    <VaultShell view={view} setView={setView} user={user} />
  );
}

function SetupGate() {
  return (
    <main className="gate">
      <section className="gate-panel">
        <p className="eyebrow">VaultX</p>
        <h1>Config required</h1>
        <p className="muted">Set the Supabase environment variables to continue.</p>
      </section>
    </main>
  );
}

function AccessGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError('Access denied');
    }

    setLoading(false);
  }

  return (
    <main className="gate">
      <form className="gate-panel" onSubmit={submit}>
        <p className="eyebrow">VaultX</p>
        <h1>This site is locked</h1>
        <p className="muted">Please enter your access credentials to continue.</p>
        <label>
          <span>Access ID</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required />
        </label>
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

function VaultShell({ view, setView, user }: { view: View; setView: (view: View) => void; user: User }) {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refreshEntries() {
    setLoading(true);
    setError('');

    try {
      setEntries(await listEntries());
    } catch {
      setError('Unable to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshEntries();
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('search')}>VaultX</button>
        <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => supabase.auth.signOut()}>
          <LogOut size={18} />
        </button>
      </header>

      {error && <p className="status error">{error}</p>}
      {loading && <p className="status">Loading</p>}

      {!loading && view === 'search' && <SearchView entries={entries} />}
      {!loading && view === 'explore' && <ExploreView entries={entries} />}
      {!loading && view === 'upload' && <UploadView userId={user.id} onUploaded={refreshEntries} />}

      <nav className="bottom-nav" aria-label="Views">
        <Tab active={view === 'search'} icon={<Search size={20} />} label="Search" onClick={() => setView('search')} />
        <Tab active={view === 'explore'} icon={<Compass size={20} />} label="Explore" onClick={() => setView('explore')} />
        <Tab active={view === 'upload'} icon={<UploadCloud size={20} />} label="Upload" onClick={() => setView('upload')} />
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

function SearchView({ entries }: { entries: DisplayEntry[] }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter((entry) => {
      const keywords = entry.keywords || [];
      return entry.display_name.toLowerCase().includes(normalizedQuery) || keywords.some((keyword) => keyword.includes(normalizedQuery));
    });
  }, [entries, normalizedQuery]);

  return (
    <section className="view search-view">
      <div className="searchbar">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search" />
      </div>
      <div className="grid" aria-live="polite">
        {filtered.map((entry) => (
          <MediaTile key={entry.id} entry={entry} />
        ))}
      </div>
      {!filtered.length && <p className="status">Empty</p>}
    </section>
  );
}

function ExploreView({ entries }: { entries: DisplayEntry[] }) {
  const shuffled = useMemo(() => [...entries].sort(() => Math.random() - 0.5), [entries]);

  return (
    <section className="explore-view" aria-live="polite">
      {shuffled.map((entry) => (
        <article className="stage" key={entry.id}>
          <MediaTile entry={entry} mode="stage" />
        </article>
      ))}
      {!shuffled.length && <p className="status">Empty</p>}
    </section>
  );
}

function UploadView({ userId, onUploaded }: { userId: string; onUploaded: () => Promise<void> }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!selectedFiles.length) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      await uploadEntries(selectedFiles, userId);
      setSelectedFiles([]);
      await onUploaded();
    } catch {
      setError('Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="view upload-view">
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
          setSelectedFiles(Array.from(event.dataTransfer.files).filter(isSupportedFile));
        }}
      >
        <UploadCloud size={34} />
        <span>Drop or select</span>
        <input
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={(event) => setSelectedFiles(Array.from(event.target.files || []).filter(isSupportedFile))}
        />
      </label>

      {!!selectedFiles.length && (
        <div className="upload-list">
          {selectedFiles.map((file) => (
            <p key={`${file.name}-${file.size}`}>{file.name}</p>
          ))}
        </div>
      )}

      {error && <p className="status error">{error}</p>}
      <button className="primary" type="button" onClick={submit} disabled={!selectedFiles.length || loading}>
        {loading ? 'Uploading' : 'Upload'}
      </button>
    </section>
  );
}

function isSupportedFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}
