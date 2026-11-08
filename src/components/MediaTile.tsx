import type { KeyboardEvent } from 'react';
import { Film } from 'lucide-react';
import type { DisplayEntry } from '../types';

type MediaTileProps = {
  entry: DisplayEntry;
  mode?: 'grid' | 'stage';
  onSelect?: (entry: DisplayEntry) => void;
};

export function MediaTile({ entry, mode = 'grid', onSelect }: MediaTileProps) {
  function openEditor() {
    onSelect?.(entry);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEditor();
    }
  }

  return (
    <figure
      className="media-tile"
      onClick={openEditor}
      onKeyDown={onSelect ? handleKeyDown : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `Open ${entry.mediaType} media` : undefined}
    >
      {entry.mediaType === 'video' ? (
        <div className="media-preview video-preview" aria-hidden="true">
          <Film size={30} strokeWidth={1.5} />
          <span>VIDEO</span>
        </div>
      ) : (
        <img className="media-preview" src={entry.previewUrl || entry.mediaUrl} alt={entry.tags.join(', ')} loading="lazy" decoding="async" />
      )}
    </figure>
  );
}
