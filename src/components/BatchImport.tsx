import { type FormEvent, useEffect, useRef, useState } from 'react';
import { mediaType, validateFolderName } from '../lib/local-vault';
import type { ImportSource, SourceCollection } from '../lib/import-sources';
import { executeBatch, type BatchResult, type BatchStatus } from '../lib/batch-import';
import { TagPicker, tagKey } from './TagPicker';

export type BatchItem = ImportSource & {
  id: string;
  parent: string;
  keywords: string[];
  status: BatchStatus;
  detail?: string;
};

export function BatchImport({ parents, keywords, incoming, writing, onIncomingConsumed, onCreateKeyword, onPermission, onImport, onRefresh, onRunningChange, onClose }: {
  parents: string[];
  keywords: string[];
  incoming: SourceCollection | undefined;
  writing: boolean;
  onIncomingConsumed: (incoming: SourceCollection) => void;
  onCreateKeyword: (value: string) => Promise<string>;
  onPermission: () => Promise<void>;
  onImport: (item: BatchItem, staged: boolean) => Promise<BatchResult>;
  onRefresh: () => Promise<void>;
  onRunningChange: (running: boolean) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stagedParents, setStagedParents] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [folderSupported] = useState(() => 'webkitdirectory' in document.createElement('input'));
  const dialog = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  const consumed = useRef<SourceCollection>();
  closeRef.current = onClose;
  busyRef.current = running || writing;

  function addSources(collection: SourceCollection) {
    const supported = collection.files.filter(({ file }) => mediaType(file.name));
    const unsupported = collection.files.filter(({ file }) => !mediaType(file.name)).map(({ path }) => `${path}: unsupported media type.`);
    setWarnings((current) => [...current, ...collection.errors, ...unsupported]);
    setItems((current) => [...current, ...supported.map((source): BatchItem => ({ ...source, id: crypto.randomUUID(), parent: '', keywords: [], status: 'pending' }))]);
  }

  useEffect(() => {
    if (incoming && incoming !== consumed.current) {
      consumed.current = incoming;
      addSources(incoming);
      onIncomingConsumed(incoming);
    }
  }, [incoming, onIncomingConsumed]);

  useEffect(() => {
    const previous = document.activeElement;
    const form = dialog.current;
    if (!form) return;
    form.querySelector<HTMLElement>('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !form) return;
      const elements = [...form.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!elements.length) { event.preventDefault(); return; }
      const index = document.activeElement instanceof HTMLElement ? elements.indexOf(document.activeElement) : -1;
      if (event.shiftKey && index <= 0) { event.preventDefault(); elements[elements.length - 1].focus(); }
      else if (!event.shiftKey && (index === -1 || index === elements.length - 1)) { event.preventDefault(); elements[0].focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function update(id: string, changes: Partial<BatchItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = items.filter((item) => item.status === 'pending' || item.status === 'failed');
    if (!pending.length || pending.some((item) => !item.parent) || running || writing) return;
    setRunning(true);
    onRunningChange(true);
    setPaused(false);
    setError('');
    setHasRun(true);
    try {
      await onPermission();
      const interrupted = await executeBatch(items, (item) => onImport(item, stagedParents.some((parent) => tagKey(parent) === tagKey(item.parent))), (item, result) => {
        update(item.id, { status: result.status, detail: result.detail });
      });
      if (interrupted) setPaused(true);
    } catch (caught) {
      setPaused(true);
      setError(caught instanceof Error ? caught.message : 'Import could not continue.');
    } finally {
      try {
        await onRefresh();
      } catch (caught) {
        setError(`Could not refresh the vault. ${caught instanceof Error ? caught.message : 'Check folder access.'}`);
      }
      setRunning(false);
      onRunningChange(false);
    }
  }

  const pending = items.filter((item) => item.status === 'pending' || item.status === 'failed');
  const allParents = [...parents, ...stagedParents.filter((name) => !parents.some((parent) => tagKey(parent) === tagKey(name)))];
  return <div className="dialog-backdrop">
    <form className="detail-dialog batch-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="batch-title" onSubmit={submit}>
      <header className="dialog-header"><h2 id="batch-title">Import media</h2></header>
      <div className="batch-pickers">
        <label className="secondary">Choose files<input className="visually-hidden" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov" disabled={running || writing} onChange={(event) => {
          addSources({ files: Array.from(event.target.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })), errors: [] });
          event.target.value = '';
        }} /></label>
        <label className="secondary">Choose folder<input className="visually-hidden" type="file" multiple disabled={running || writing || !folderSupported} ref={(input) => { input?.setAttribute('webkitdirectory', ''); }}
          onChange={(event) => {
            addSources({ files: Array.from(event.target.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })), errors: [] });
            event.target.value = '';
          }} /></label>
      </div>
      {!folderSupported && <p className="muted">Folder selection is unavailable here. Choose individual files instead.</p>}
      {!!warnings.length && <div className="batch-warnings" role="status">{warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>}
      {!items.length && <p className="muted">Choose or drop files or a folder.</p>}
      <div className="batch-list">
        {items.map((item) => {
          const editable = !running && !writing && (item.status === 'pending' || item.status === 'failed');
          return <div className="batch-row" key={item.id}>
            <div className="batch-file"><strong title={item.path}>{item.file.name}</strong><span>{item.file.name.split('.').pop()} · {mediaType(item.file.name)}</span><span className="visually-hidden">{item.path}</span></div>
            <TagPicker label={`Parent tag for ${item.path}`} placeholder="Parent tag" values={item.parent ? [item.parent] : []} options={allParents} disabled={!editable}
              onChange={(values) => update(item.id, { parent: values[0] ?? '' })}
              onCreate={async (name) => {
                const valid = validateFolderName(name);
                setStagedParents((current) => [...current, valid]);
                return valid;
              }} />
            <TagPicker label={`Keywords for ${item.path}`} placeholder="Keywords" values={item.keywords} options={keywords} multiple maxValues={30} disabled={!editable}
              onChange={(values) => update(item.id, { keywords: values })} onCreate={onCreateKeyword} />
            <button type="button" className="secondary" disabled={running || writing} aria-label={`Remove ${item.path}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>Remove</button>
            {(item.status !== 'pending' || item.detail) && <p className={item.status === 'saved' ? 'muted batch-status' : 'error batch-status'}>{item.status === 'saved' ? 'Imported' : item.status === 'attention' ? 'Needs inspection' : item.status === 'failed' ? 'Failed' : 'Waiting'}{item.detail ? `: ${item.detail}` : ''}</p>}
            {item.status === 'attention' && <button className="secondary batch-retry" type="button" disabled={running || writing} onClick={() => {
              if (window.confirm('Inspect the destination and resolve any partial copy or metadata first. Retry this item?')) update(item.id, { status: 'pending', detail: undefined });
            }}>Retry after inspection</button>}
          </div>;
        })}
      </div>
      {paused && <p className="error" role="alert">Import paused. Resolve the issue shown above before resuming; items needing inspection will not be retried automatically.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {hasRun && !running && <p className="muted" role="status">{items.filter((item) => item.status === 'saved').length} imported; {items.filter((item) => item.status === 'failed' || item.status === 'attention').length} need attention; {items.filter((item) => item.status === 'pending').length} pending.</p>}
      <div className="form-actions"><button className="secondary" type="button" disabled={running || writing} onClick={onClose}>Close</button><button className="primary" type="submit"
        disabled={running || writing || !pending.length || pending.some((item) => !item.parent)}>{running ? 'Importing…' : hasRun ? 'Import remaining' : 'Import media'}</button></div>
    </form>
  </div>;
}
