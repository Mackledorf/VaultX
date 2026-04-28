import type { KeyboardEvent } from 'react';
import type { DisplayEntry } from '../types';

type MediaTileProps = {
  entry: DisplayEntry;
  mode?: 'grid' | 'stage';
  onSelect?: (entry: DisplayEntry) => void;
};

export function MediaTile({ entry, mode = 'grid', onSelect }: MediaTileProps) {
  const isStage = mode === 'stage';
  const tileClassName = isStage ? 'media-tile media-tile-stage' : 'media-tile media-tile-grid';
  const mediaClassName = isStage ? 'media media-stage' : 'media media-grid';

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
      className={tileClassName}
      onClick={openEditor}
      onKeyDown={onSelect ? handleKeyDown : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `Edit tags for ${entry.display_name}` : undefined}
    >
      {entry.object_kind === 'video' ? (
      <video
        className={mediaClassName}
        src={entry.signedUrl}
        autoPlay
        loop
        muted
        playsInline
        controls
        preload="metadata"
      />
      ) : (
        <img className={mediaClassName} src={entry.signedUrl} alt="" loading="lazy" />
      )}
    </figure>
  );
}
