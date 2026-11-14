import { useId, useState } from 'react';

export function tagKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function TagPicker({ label, placeholder, values, options, multiple = false, maxValues, disabled = false, onChange, onCreate }: {
  label: string;
  placeholder: string;
  values: string[];
  options: string[];
  multiple?: boolean;
  maxValues?: number;
  disabled?: boolean;
  onChange: (values: string[]) => void;
  onCreate: (value: string) => Promise<string>;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const listId = useId();
  const query = tagKey(input);
  const suggestions = options.filter((option) => !values.some((value) => tagKey(value) === tagKey(option)) && (!query || tagKey(option).includes(query)));
  const existing = options.find((option) => tagKey(option) === query);
  const canCreate = !!query && !existing;
  const count = suggestions.length + (canCreate ? 1 : 0);

  function select(value: string) {
    if (multiple && maxValues !== undefined && values.length >= maxValues) {
      setError(`Use at most ${maxValues} tags.`);
      return;
    }
    onChange(multiple ? [...values, value] : [value]);
    setInput('');
    setError('');
    setOpen(false);
    setActive(0);
  }

  async function create() {
    if (!canCreate || creating) return;
    if (multiple && maxValues !== undefined && values.length >= maxValues) {
      setError(`Use at most ${maxValues} tags.`);
      return;
    }
    setCreating(true);
    setError('');
    try {
      select(await onCreate(input.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the tag.');
    } finally {
      setCreating(false);
    }
  }

  return <div className="tag-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="tag-picker-input">
      {values.map((value) => <span className="tag-chip" key={tagKey(value)}>{value}<button type="button" disabled={disabled || creating} aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter((item) => tagKey(item) !== tagKey(value)))}>×</button></span>)}
      {(multiple || !values.length) && <input aria-label={label} role="combobox" aria-expanded={open && count > 0} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && count ? `${listId}-${Math.min(active, count - 1)}` : undefined}
        autoComplete="off" disabled={disabled || creating} value={input} placeholder={placeholder}
        onFocus={() => setOpen(true)} onChange={(event) => {
          const value = event.target.value;
          const key = tagKey(value);
          const matches = options.filter((option) => !values.some((selected) => tagKey(selected) === tagKey(option)) && (!key || tagKey(option).includes(key)));
          setInput(value);
          setOpen(true);
          setActive(key && !options.some((option) => tagKey(option) === key) ? matches.length : Math.max(0, matches.findIndex((option) => tagKey(option) === key)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          else if (event.key === 'ArrowDown' && count) { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, count - 1)); }
          else if (event.key === 'ArrowUp' && count) { event.preventDefault(); setOpen(true); setActive((index) => Math.max(index - 1, 0)); }
          else if (event.key === 'Enter' && open && count) {
            event.preventDefault();
            const index = Math.min(active, count - 1);
            if (index < suggestions.length) select(suggestions[index]);
            else void create();
          } else if (event.key === 'Enter') event.preventDefault();
        }} />}
    </div>
    {open && count > 0 && <div className="tag-picker-options" id={listId} role="listbox" aria-label={`${label} suggestions`}>
      {suggestions.map((option, index) => <button id={`${listId}-${index}`} type="button" role="option" aria-selected={index === active} key={tagKey(option)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)}>{option}</button>)}
      {canCreate && <button id={`${listId}-${suggestions.length}`} type="button" role="option" aria-selected={active === suggestions.length}
        onMouseDown={(event) => event.preventDefault()} onClick={() => void create()}>+ Add “{input.trim()}”</button>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
