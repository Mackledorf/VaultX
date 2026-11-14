import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { checkRecoveryState, createKeyword, createParent, createVault, importMedia, ImportError, initializeVault, moveMedia, readVaultMetadata, scanVault, updateMediaKeywords, validateFolderName, type LocalDirectoryHandle, type LocalMedia, type VaultContents } from '../lib/local-vault';
import { captureDrop, collectDrop, type SourceCollection } from '../lib/import-sources';
import { loadVaultHandle, saveVaultHandle } from '../lib/vault-handle';
import { BatchImport, type BatchItem } from './BatchImport';
import type { BatchResult } from '../lib/batch-import';
import { TagPicker, tagKey } from './TagPicker';
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

class BatchBlockedError extends Error {}

async function ensureStagedParent(directory: LocalDirectoryHandle, name: string, staged: boolean): Promise<void> {
  if (!staged) return;
  try { await directory.getDirectoryHandle(name); }
  catch (caught) {
    if (!(caught instanceof DOMException && caught.name === 'NotFoundError')) throw caught;
    await createParent(directory, name);
  }
}

export function LocalVault() {
  const [remembered, setRemembered] = useState<LocalDirectoryHandle>();
  const [directory, setDirectory] = useState<LocalDirectoryHandle>();
  const [pending, setPending] = useState<LocalDirectoryHandle>();
  const [contents, setContents] = useState<VaultContents>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [keywordFilter, setKeywordFilter] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [parent, setParent] = useState('');
  const [type, setType] = useState<MediaType | 'all'>('all');
  const [selected, setSelected] = useState<LocalMedia>();
  const [creating, setCreating] = useState(false);
  const [vaultName, setVaultName] = useState('');
  const [dialog, setDialog] = useState<'import' | 'copy' | 'move' | 'keywords'>();
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [incoming, setIncoming] = useState<SourceCollection>();
  const dragDepth = useRef(0);
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

  useEffect(() => {
    function hasFiles(event: DragEvent) { return Array.from(event.dataTransfer?.types ?? []).includes('Files'); }
    function enter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      if (directory && contents && !busy && !writing && !batchRunning && !collecting && (!dialog || dialog === 'import') && !(selected && !dialog)) setDragging(true);
    }
    function over(event: DragEvent) { if (hasFiles(event)) event.preventDefault(); }
    function leave() {
      if (!dragDepth.current) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }
    function resetDrag() { dragDepth.current = 0; setDragging(false); }
    function drop(event: DragEvent) {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!directory || !contents || busy || writing || batchRunning || collecting || (dialog && dialog !== 'import') || (selected && !dialog)) return;
      let captured: ReturnType<typeof captureDrop>;
      try { captured = captureDrop(event.dataTransfer); }
      catch (caught) {
        setIncoming({ files: [], errors: [message(caught)] });
        setDialog('import');
        return;
      }
      setCollecting(true);
      setDialog('import');
      void collectDrop(captured).then((result) => {
        setIncoming(result.files.length || result.errors.length ? result : { files: [], errors: ['No readable files were found in the drop.'] });
      }).catch((caught: unknown) => {
        setIncoming({ files: [], errors: [message(caught)] });
      }).finally(() => setCollecting(false));
    }
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('blur', resetDrag);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('blur', resetDrag);
    };
  }, [directory, contents, busy, writing, batchRunning, collecting, dialog, selected]);

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
    setKeywords(metadata.keywords);
    setParent('');
    setKeywordFilter([]);
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
      setKeywords(metadata.keywords);
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
        await checkRecoveryState(directory);
        await action();
      });
      try {
        const metadata = await readVaultMetadata(directory);
        if (!metadata) throw new Error('The vault marker is missing.');
        setContents(await scanVault(directory, metadata));
        setKeywords(metadata.keywords);
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

  async function tagWrite<T>(action: () => Promise<T>, refreshContents = false): Promise<T> {
    if (!directory) throw new Error('Open a vault first.');
    setWriting(true);
    try {
      if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Write access was not granted. No files were changed.');
      const result = await withWriteLock(async () => { await checkRecoveryState(directory); return action(); });
      try {
        const metadata = await readVaultMetadata(directory);
        if (!metadata) throw new Error('The vault marker is missing.');
        setKeywords(metadata.keywords);
        if (refreshContents) setContents(await scanVault(directory, metadata));
      } catch (caught) {
        throw new Error(`The tag was saved, but the vault could not be refreshed. ${message(caught)}`);
      }
      return result;
    } finally {
      setWriting(false);
    }
  }

  async function addKeyword(value: string): Promise<string> {
    if (!directory) throw new Error('Open a vault first.');
    return tagWrite(() => createKeyword(directory, value));
  }

  async function importItem(item: BatchItem, staged: boolean): Promise<BatchResult> {
    if (!directory) return { status: 'failed', detail: 'The vault is not open.', pause: true };
    if (!navigator.locks) return { status: 'pending', detail: 'This browser cannot safely coordinate vault writes. Use a current version of Chrome or Edge.', pause: true };
    try {
      await withWriteLock(async () => {
        try { await checkRecoveryState(directory); }
        catch (caught) { throw new BatchBlockedError(message(caught)); }
        await ensureStagedParent(directory, item.parent, staged);
        await importMedia(directory, item.parent, item.file, item.keywords);
      });
      return { status: 'saved' };
    } catch (caught) {
      if (caught instanceof ImportError) return { status: 'attention', detail: caught.message, pause: caught.phase === 'metadata' || caught.permissionDenied };
      if (caught instanceof BatchBlockedError) return { status: 'pending', detail: caught.message, pause: true };
      try { await checkRecoveryState(directory); }
      catch (recovery) { return { status: 'pending', detail: `${message(caught)} ${message(recovery)}`, pause: true }; }
      if (caught instanceof DOMException && caught.name === 'NotAllowedError') return { status: 'pending', detail: message(caught), pause: true };
      return { status: 'failed', detail: message(caught) };
    }
  }

  const visible = contents?.media.filter((item) =>
    (!parent || item.parent === parent) &&
    (type === 'all' || item.type === type) &&
    keywordFilter.every((term) => item.keywords.some((keyword) => tagKey(keyword) === tagKey(term))),
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
          <button className="secondary" type="button" onClick={() => { setWriteError(''); setIncoming(undefined); setDialog('import'); }} disabled={busy || writing}>Add media</button>
          <button className="secondary" type="button" onClick={refresh} disabled={busy || writing}>Refresh</button>
          <button className="secondary" type="button" disabled={busy || writing} onClick={() => { setDirectory(undefined); setContents(undefined); setSelected(undefined); setError(''); }}>Close vault</button>
        </div>
      </header>
      <section className="search-section local-controls">
        <TagPicker label="Parent tag" placeholder="Parent Tag" values={parent ? [parent] : []} options={contents.parents} disabled={writing}
          onChange={(values) => setParent(values[0] ?? '')} onCreate={async (name) => {
            const valid = validateFolderName(name);
            await tagWrite(() => createParent(directory, valid), true);
            return valid;
          }} />
        <TagPicker label="Search keywords" placeholder="Search keywords" values={keywordFilter} options={keywords} multiple disabled={writing}
          onChange={setKeywordFilter} onCreate={addKeyword} />
        <div className="media-type-buttons" role="group" aria-label="Media type">
          {([['all', 'All'], ['image', 'Images'], ['gif', 'GIFs'], ['video', 'Videos']] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>)}
        </div>
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
      {dialog === 'import' && <BatchImport parents={contents.parents} keywords={keywords} incoming={incoming} writing={writing || collecting}
        onIncomingConsumed={(value) => setIncoming((current) => current === value ? undefined : current)} onCreateKeyword={addKeyword}
        onPermission={async () => {
          if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Write access was not granted. No files were changed.');
        }}
        onImport={importItem}
        onRefresh={async () => {
          const metadata = await readVaultMetadata(directory);
          if (!metadata) throw new Error('The vault marker is missing.');
          setKeywords(metadata.keywords);
          setContents(await scanVault(directory, metadata));
        }} onRunningChange={setBatchRunning}
        onClose={() => { setDialog(undefined); setIncoming(undefined); }} />}
      {dialog && dialog !== 'import' && <WriteDialog key={dialog} mode={dialog} parents={contents.parents} keywords={keywords} item={selected} error={writeError} writing={writing}
        onClose={() => { setDialog(undefined); setWriteError(''); }}
        onCreateKeyword={addKeyword}
        onCopy={(destination, source, staged) => write(async () => { await ensureStagedParent(directory, destination, staged); await importMedia(directory, destination, await source.handle.getFile(), source.keywords); })}
        onMove={(destination, source, staged) => write(async () => { await ensureStagedParent(directory, destination, staged); await moveMedia(directory, source, destination); })}
        onKeywords={(source, values) => write(() => updateMediaKeywords(directory, source, values))} />}
      {dragging && <div className="drag-overlay" aria-hidden="true">Drop files or folders to import</div>}
    </main>
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

function WriteDialog({ mode, parents, keywords, item, error, writing, onClose, onCreateKeyword, onCopy, onMove, onKeywords }: {
  mode: 'copy' | 'move' | 'keywords';
  parents: string[];
  keywords: string[];
  item?: LocalMedia;
  error: string;
  writing: boolean;
  onClose: () => void;
  onCreateKeyword: (value: string) => Promise<string>;
  onCopy: (parent: string, item: LocalMedia, staged: boolean) => Promise<boolean>;
  onMove: (parent: string, item: LocalMedia, staged: boolean) => Promise<boolean>;
  onKeywords: (item: LocalMedia, keywords: string[]) => Promise<boolean>;
}) {
  const [destination, setDestination] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState(item?.keywords ?? []);
  const [fileError, setFileError] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus(dialogRef, onClose, writing);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError('');
    if (!item) { setFileError('Select a media file first.'); return; }
    if (mode === 'keywords') { await onKeywords(item, selectedKeywords); return; }
    if (!destination) { setFileError('Choose a parent folder first.'); return; }
    const staged = !parents.some((parent) => tagKey(parent) === tagKey(destination));
    if (mode === 'copy') await onCopy(destination, item, staged);
    else await onMove(destination, item, staged);
  }

  return <div className="dialog-backdrop">
    <form ref={dialogRef} className="detail-dialog local-form" role="dialog" aria-modal="true" aria-labelledby="write-title" onSubmit={submit}>
      <header className="dialog-header"><h2 id="write-title">{mode === 'copy' ? 'Copy to parent' : mode === 'move' ? 'Move to parent' : 'Edit keywords'}</h2></header>
      {mode === 'keywords' ? <TagPicker label="Keywords" placeholder="Keywords" values={selectedKeywords} options={keywords} multiple maxValues={30} disabled={writing}
        onChange={setSelectedKeywords} onCreate={onCreateKeyword} /> : <>
        <TagPicker label="Parent tag" placeholder="Parent tag" values={destination ? [destination] : []} options={parents.filter((parent) => parent !== item?.parent)} disabled={writing}
          onChange={(values) => setDestination(values[0] ?? '')}
          onCreate={async (name) => {
            const valid = validateFolderName(name);
            if (item && tagKey(valid) === tagKey(item.parent)) throw new Error('Choose a different parent.');
            return valid;
          }} />
        <p className="muted">{mode === 'move' ? 'The file will be copied and verified, then removed from its current folder. Back up your vault first.' : 'A copy will be added to the selected parent. The original stays in place.'}</p>
      </>}
      {(fileError || error) && <p className="error" role="alert">{fileError || error}</p>}
      <div className="form-actions"><button className="secondary" type="button" disabled={writing} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={writing || (mode !== 'keywords' && !destination)}>{writing ? 'Saving…' : mode === 'copy' ? 'Copy' : mode === 'move' ? 'Move file' : 'Save keywords'}</button></div>
    </form>
  </div>;
}
