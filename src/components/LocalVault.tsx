import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { ChevronDown, Film } from 'lucide-react';
import { createParent, createVault, importMedia, initializeVault, moveMedia, readVaultMetadata, scanVault, updateMediaKeywords, validateFolderName, type LocalDirectoryHandle, type LocalMedia, type VaultContents } from '../lib/local-vault';
import { loadVaultHandle, saveVaultHandle } from '../lib/vault-handle';
import type { MediaType } from '../types';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'read' | 'readwrite' }) => Promise<LocalDirectoryHandle>;
};

function message(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Folder access was denied or revoked. Select the folder again and allow access.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'The folder or a file is no longer available. Select the folder again or refresh.';
  return error instanceof Error ? error.message : 'Could not open the vault. Check folder access and try again.';
}

async function withWriteLock<T>(action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('This browser cannot safely coordinate vault writes. Use a current version of Chrome or Edge.');
  return await navigator.locks.request('vaultx-local-write', action);
}

export function LocalVault() {
  const [remembered, setRemembered] = useState<LocalDirectoryHandle>();
  const [directory, setDirectory] = useState<LocalDirectoryHandle>();
  const [pending, setPending] = useState<LocalDirectoryHandle>();
  const [contents, setContents] = useState<VaultContents>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [parent, setParent] = useState('');
  const [type, setType] = useState<MediaType | 'all'>('all');
  const [selected, setSelected] = useState<LocalMedia>();
  const [creating, setCreating] = useState(false);
  const [vaultName, setVaultName] = useState('');
  const [dialog, setDialog] = useState<'parent' | 'import' | 'copy' | 'move' | 'keywords'>();
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

  useEffect(() => {
    let active = true;
    loadVaultHandle().then((handle) => {
      if (active && handle?.kind === 'directory') setRemembered(handle);
    }).catch(() => {
      if (active) setNotice('Vault reconnect is unavailable in this browser. You can still select a folder.');
    });
    return () => { active = false; };
  }, []);

  async function open(handle: LocalDirectoryHandle) {
    const metadata = await readVaultMetadata(handle);
    if (!metadata) {
      setPending(handle);
      setDirectory(undefined);
      setContents(undefined);
      return;
    }
    const result = await scanVault(handle, metadata);
    setPending(undefined);
    setDirectory(handle);
    setContents(result);
    setParent('');
    setQuery('');
    setType('all');
    try {
      await saveVaultHandle(handle);
      setRemembered(handle);
    } catch {
      setNotice('Could not remember this folder. Select it again next time.');
    }
  }

  async function choose() {
    if (!picker) return;
    setError('');
    setNotice('');
    setPending(undefined);
    setCreating(false);
    setBusy(true);
    try {
      const handle = await picker.call(window, { mode: 'read' });
      await open(handle);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!picker) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      validateFolderName(vaultName);
      const location = await picker.call(window, { mode: 'readwrite' });
      const vault = await withWriteLock(() => createVault(location, vaultName));
      setCreating(false);
      setVaultName('');
      try {
        await open(vault);
      } catch (caught) {
        throw new Error(`The vault folder was created, but could not be opened. ${message(caught)}`);
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    if (!remembered) return;
    setError('');
    setNotice('');
    setPending(undefined);
    setBusy(true);
    try {
      const permission = await remembered.queryPermission({ mode: 'read' });
      if (permission !== 'granted' && await remembered.requestPermission({ mode: 'read' }) !== 'granted') {
        throw new Error('Folder access was not granted. Select the folder again or allow access.');
      }
      await open(remembered);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    if (!pending) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (await pending.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Write access is required to create the vault marker. No media was changed.');
      }
      await withWriteLock(() => initializeVault(pending));
      await open(pending);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!directory) return;
    setError('');
    setBusy(true);
    setSelected(undefined);
    try {
      const metadata = await readVaultMetadata(directory);
      if (!metadata) throw new Error('The vault marker is missing. No files were changed; restore it before refreshing.');
      setContents(await scanVault(directory, metadata));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function write(action: () => Promise<void>): Promise<boolean> {
    if (!directory) return false;
    setWriteError('');
    setWriting(true);
    try {
      if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Write access was not granted. No files were changed.');
      }
      await withWriteLock(async () => {
        const metadata = await readVaultMetadata(directory);
        if (!metadata) throw new Error('The vault marker is missing. No files were changed.');
        const current = await scanVault(directory, metadata);
        if (current.recoveryBackups.length || current.pendingOperations.length) {
          throw new Error('Resolve the incomplete operation or metadata backup in the vault folder before making changes. See LOCAL-VAULT.md.');
        }
        await action();
      });
      try {
        const metadata = await readVaultMetadata(directory);
        if (!metadata) throw new Error('The vault marker is missing.');
        setContents(await scanVault(directory, metadata));
      } catch (caught) {
        throw new Error(`The change was saved, but the vault could not be refreshed. ${message(caught)}`);
      }
      setSelected(undefined);
      setDialog(undefined);
      return true;
    } catch (caught) {
      setWriteError(message(caught));
      return false;
    } finally {
      setWriting(false);
    }
  }

  const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = contents?.media.filter((item) =>
    (!parent || item.parent === parent) &&
    (type === 'all' || item.type === type) &&
    terms.every((term) => item.keywords.some((keyword) => keyword.normalize('NFKC').toLocaleLowerCase().includes(term))),
  ) ?? [];

  if (!directory || !contents) {
    return (
      <main className="gate">
        <section className="gate-panel">
          <h1>Open a local vault</h1>
          {!picker && <p className="error">Folder access is unavailable here. Use a supported desktop browser such as Chrome or Edge over HTTPS or localhost.</p>}
          {pending && (
            <div className="local-initialize">
              <p><strong>{pending.name}</strong> has no vault marker. Initialize it by creating <code>vaultx.json</code>? Existing files and folders will be kept.</p>
              <button className="primary" type="button" disabled={busy} onClick={initialize}>Initialize this folder</button>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="muted" role="status">{notice}</p>}
          <div className="gate-actions">
            <button className="secondary" type="button" disabled={!picker || busy} onClick={() => { setCreating(true); setPending(undefined); setError(''); }}>New vault</button>
            <button className="primary" type="button" disabled={!picker || busy} onClick={choose}>Choose folder</button>
          </div>
          {creating && <form className="local-form" onSubmit={create}>
            <label>Vault name<input value={vaultName} onChange={(event) => setVaultName(event.target.value)} required autoFocus /></label>
            <div className="form-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel</button><button className="primary" type="submit" disabled={busy}>Choose location</button></div>
          </form>}
          {remembered && <button className="secondary" type="button" disabled={busy} onClick={reconnect}>Reconnect to {remembered.name}</button>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1 className="local-vault-name">{directory.name}</h1>
        <div className="topbar-actions local-actions">
          <button className="secondary" type="button" onClick={() => { setWriteError(''); setDialog('import'); }} disabled={busy}>Add media</button>
          <button className="secondary" type="button" onClick={refresh} disabled={busy}>Refresh</button>
          <button className="secondary" type="button" onClick={() => { setDirectory(undefined); setContents(undefined); setSelected(undefined); setError(''); }}>Close vault</button>
        </div>
      </header>
      <section className="search-section local-controls">
        <FilterDropdown label="Parent tag" value={parent} onChange={setParent} options={[
          { value: '', label: 'Parent Tag' },
          ...contents.parents.map((name) => ({ value: name, label: name })),
        ]} onCreate={() => { setWriteError(''); setDialog('parent'); }} />
        <input aria-label="Search keywords" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keywords" />
        <FilterDropdown label="Media type" value={type} onChange={setType} options={[
          { value: 'all', label: 'All media' },
          { value: 'image', label: 'Images' },
          { value: 'gif', label: 'GIFs' },
          { value: 'video', label: 'Videos' },
        ]} />
      </section>
      <section className="results-section">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="local-notice" role="status">{notice}</p>}
        {(contents.unindexed > 0 || contents.missing.length > 0 || contents.rootMedia > 0 || contents.nestedFolders > 0 || contents.recoveryBackups.length > 0 || contents.pendingOperations.length > 0) && (
          <div className="local-notices">
            {contents.unindexed > 0 && <p>{contents.unindexed} media {contents.unindexed === 1 ? 'file has' : 'files have'} no metadata and {contents.unindexed === 1 ? 'is' : 'are'} shown without keywords.</p>}
            {contents.missing.length > 0 && <p>{contents.missing.length} indexed {contents.missing.length === 1 ? 'file is' : 'files are'} missing or unsupported. Metadata has not been changed.</p>}
            {contents.rootMedia > 0 && <p>{contents.rootMedia} media {contents.rootMedia === 1 ? 'file is' : 'files are'} in the vault root; move {contents.rootMedia === 1 ? 'it' : 'them'} into a parent folder to browse.</p>}
            {contents.nestedFolders > 0 && <p>{contents.nestedFolders} nested {contents.nestedFolders === 1 ? 'folder is' : 'folders are'} not scanned.</p>}
            {contents.recoveryBackups.length > 0 && <p>Metadata backup files found: {contents.recoveryBackups.join(', ')}. Inspect them before making further changes.</p>}
            {contents.pendingOperations.length > 0 && <p>Incomplete moves found: {contents.pendingOperations.join(', ')}. Inspect the original, copy and metadata before making further changes. See the recovery instructions in LOCAL-VAULT.md.</p>}
          </div>
        )}
        {(busy || (!error && !visible.length)) && <p className="local-result-status" role="status">{busy ? 'Searching…' : 'No media to show'}</p>}
        {!busy && !!visible.length && <div className="media-grid local-grid">{visible.map((item) => <LocalTile key={JSON.stringify([item.parent, item.name])} item={item} onSelect={setSelected} />)}</div>}
      </section>
      {selected && !dialog && <LocalDetail item={selected} onClose={() => setSelected(undefined)}
        onCopy={() => { setWriteError(''); setDialog('copy'); }}
        onMove={() => { setWriteError(''); setDialog('move'); }}
        onKeywords={() => { setWriteError(''); setDialog('keywords'); }} />}
      {dialog && <WriteDialog key={dialog} mode={dialog} parents={contents.parents} item={selected} error={writeError} writing={writing}
        onClose={() => { setDialog(undefined); setWriteError(''); }}
        onCreateParent={(name) => write(() => createParent(directory, name))}
        onCopy={(destination, source) => write(async () => { await importMedia(directory, destination, await source.handle.getFile(), source.keywords); })}
        onMove={(destination, source) => write(() => moveMedia(directory, source, destination))}
        onKeywords={(source, keywords) => write(() => updateMediaKeywords(directory, source, keywords))}
        onImport={(destination, file, keywords) => write(async () => { await importMedia(directory, destination, file, keywords); })} />}
    </main>
  );
}

function FilterDropdown<T extends string>({ label, value, options, onChange, onCreate }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  onCreate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="local-dropdown" ref={containerRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }}>
      <button ref={buttonRef} className="local-dropdown-trigger" type="button" aria-label={`${label}: ${selectedLabel}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{selectedLabel}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && <div className="local-dropdown-options" role="group" aria-label={`${label} options`}>
        {options.map((option) => (
          <button type="button" key={option.value} aria-pressed={option.value === value} onClick={() => {
            onChange(option.value);
            setOpen(false);
            buttonRef.current?.focus();
          }}>{option.label}</button>
        ))}
        {onCreate && <button type="button" onClick={() => { setOpen(false); onCreate(); }}>+ New parent</button>}
      </div>}
    </div>
  );
}

function LocalFileView({ item, large = false }: { item: LocalMedia; large?: boolean }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    if (item.type !== 'video' || large) {
      item.handle.getFile().then((file) => {
        if (active) {
          objectUrl = URL.createObjectURL(file);
          setUrl(objectUrl);
        }
      }).catch(() => { if (active) setError('Could not read this file. Refresh the vault and check access.'); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item, large]);
  if (error) return <p className="error">{error}</p>;
  if (item.type === 'video' && !large) return <div className="media-preview video-preview"><Film size={30} /><span>VIDEO</span></div>;
  if (!url) return <div className="media-preview">Loading…</div>;
  if (item.type === 'video') return <video className="detail-media" src={url} controls playsInline preload="metadata" onError={() => setError('This browser could not play the video.')} />;
  return <img className={large ? 'detail-media' : 'media-preview'} src={url} alt={item.name} loading="lazy" onError={() => setError('This browser could not display the image.')} />;
}

function LocalTile({ item, onSelect }: { item: LocalMedia; onSelect: (item: LocalMedia) => void }) {
  return <button className="local-tile" type="button" onClick={() => onSelect(item)}><LocalFileView item={item} /><span>{item.parent} / {item.name}</span></button>;
}

function useDialogFocus(container: RefObject<HTMLElement>, onClose: () => void, closingDisabled = false) {
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closingDisabled);
  closeRef.current = onClose;
  disabledRef.current = closingDisabled;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = container.current;
    if (!dialog) return;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])')];
    (dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0])?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !disabledRef.current) {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        if (!elements.length) { event.preventDefault(); return; }
        const index = document.activeElement instanceof HTMLElement ? elements.indexOf(document.activeElement) : -1;
        if (event.shiftKey && index <= 0) { event.preventDefault(); elements[elements.length - 1].focus(); }
        else if (!event.shiftKey && (index === -1 || index === elements.length - 1)) { event.preventDefault(); elements[0].focus(); }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [container]);
}

function LocalDetail({ item, onClose, onCopy, onMove, onKeywords }: { item: LocalMedia; onClose: () => void; onCopy: () => void; onMove: () => void; onKeywords: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="local-detail-title">
        <header className="dialog-header"><div><p className="eyebrow">{item.parent}</p><h2 id="local-detail-title">{item.name}</h2></div><button className="secondary" type="button" autoFocus onClick={onClose}>Close</button></header>
        <div className="detail-media-frame"><LocalFileView item={item} large /></div>
        <p className="muted">Keywords: {item.keywords.length ? item.keywords.join(', ') : 'None'}</p>
        <div className="form-actions"><button className="secondary" type="button" onClick={onKeywords}>Edit keywords</button><button className="secondary" type="button" onClick={onCopy}>Copy to parent</button><button className="secondary" type="button" onClick={onMove}>Move to parent</button></div>
      </section>
    </div>
  );
}

function WriteDialog({ mode, parents, item, error, writing, onClose, onCreateParent, onCopy, onMove, onKeywords, onImport }: {
  mode: 'parent' | 'import' | 'copy' | 'move' | 'keywords';
  parents: string[];
  item?: LocalMedia;
  error: string;
  writing: boolean;
  onClose: () => void;
  onCreateParent: (name: string) => Promise<boolean>;
  onCopy: (parent: string, item: LocalMedia) => Promise<boolean>;
  onMove: (parent: string, item: LocalMedia) => Promise<boolean>;
  onKeywords: (item: LocalMedia, keywords: string[]) => Promise<boolean>;
  onImport: (parent: string, file: File, keywords: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState(mode === 'copy' || mode === 'move' ? parents.find((parent) => parent !== item?.parent) ?? '' : parents[0] ?? '');
  const [file, setFile] = useState<File>();
  const [keywords, setKeywords] = useState(item?.keywords.join(', ') ?? '');
  const [fileError, setFileError] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus(dialogRef, onClose, writing);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError('');
    if (mode === 'parent') {
      await onCreateParent(name);
      return;
    }
    if (mode === 'keywords') {
      if (!item) { setFileError('Select a media file first.'); return; }
      await onKeywords(item, keywords.split(','));
      return;
    }
    if (!destination) {
      setFileError('Create or choose a parent folder first.');
      return;
    }
    if (mode === 'copy' || mode === 'move') {
      if (!item) { setFileError('Select a media file first.'); return; }
      if (mode === 'copy') await onCopy(destination, item);
      else await onMove(destination, item);
      return;
    }
    if (!file) {
      setFileError('Choose a media file.');
      return;
    }
    await onImport(destination, file, keywords.split(','));
  }

  return <div className="dialog-backdrop">
    <form ref={dialogRef} className="detail-dialog local-form" role="dialog" aria-modal="true" aria-labelledby="write-title" onSubmit={submit}>
      <header className="dialog-header"><h2 id="write-title">{mode === 'parent' ? 'New parent' : mode === 'copy' ? 'Copy to parent' : mode === 'move' ? 'Move to parent' : mode === 'keywords' ? 'Edit keywords' : 'Add media'}</h2></header>
      {mode === 'parent' ? <label>Parent name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus required /></label> : <>
        {mode === 'import' && <label>Media file<input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov" onChange={(event) => setFile(event.target.files?.[0])} required /></label>}
        {mode !== 'keywords' && <label>Parent tag<select value={destination} onChange={(event) => setDestination(event.target.value)} required>
          <option value="">Choose a parent</option>
          {parents.filter((parent) => (mode !== 'copy' && mode !== 'move') || parent !== item?.parent).map((parent) => <option key={parent} value={parent}>{parent}</option>)}
        </select></label>}
        {mode === 'import' || mode === 'keywords' ? <label>Keywords (optional)<input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="Separate with commas" autoFocus={mode === 'keywords'} /></label> : <p className="muted">{mode === 'move' ? 'The file will be copied and verified, then removed from its current folder. Back up your vault first.' : 'A copy will be added to the selected parent. The original stays in place.'}</p>}
        {mode !== 'keywords' && !destination && <p className="muted">Create another parent from the Parent Tag filter first.</p>}
      </>}
      {(fileError || error) && <p className="error" role="alert">{fileError || error}</p>}
      <div className="form-actions"><button className="secondary" type="button" disabled={writing} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={writing}>{writing ? 'Saving…' : mode === 'parent' ? 'Create parent' : mode === 'copy' ? 'Copy' : mode === 'move' ? 'Move file' : mode === 'keywords' ? 'Save keywords' : 'Add media'}</button></div>
    </form>
  </div>;
}
