import type { DisplayEntry } from '../types';

type MediaTileProps = {
  entry: DisplayEntry;
  mode?: 'grid' | 'stage';
};

export function MediaTile({ entry, mode = 'grid' }: MediaTileProps) {
  const isStage = mode === 'stage';
  const className = isStage ? 'media media-stage' : 'media media-grid';

  if (entry.object_kind === 'video') {
    return (
      <video
        className={className}
        src={entry.signedUrl}
        autoPlay
        loop
        muted
        playsInline
        controls
        preload="metadata"
      />
    );
  }

  return <img className={className} src={entry.signedUrl} alt="" loading="lazy" />;
}
