import { useState } from 'react';

/**
 * Click-to-load YouTube (nocookie) facade: no third-party request until the
 * viewer presses play. Until the video is published it says so.
 */
export function VideoCard({ title, youtubeId, length, testId }: { title: string; youtubeId: string | null; length: string; testId?: string }) {
  const [play, setPlay] = useState(false);
  return (
    <article className="card card-hover overflow-hidden" data-testid={testId}>
      <div className="relative aspect-video bg-raised-2">
        {youtubeId && play ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&cc_load_policy=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            className="group absolute inset-0 flex flex-col items-center justify-center gap-3 disabled:cursor-default"
            onClick={() => setPlay(true)}
            disabled={!youtubeId}
          >
            <span className="sr-only">{youtubeId ? `Play ${title}` : `${title}, not published yet`}</span>
            <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-full border border-hairline bg-bg/60 transition group-enabled:group-hover:scale-110 group-enabled:group-hover:border-verified">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
            </span>
            <span aria-hidden="true" className="text-sm text-muted">{youtubeId ? 'Plays from youtube-nocookie.com' : 'Publishing Sun 22 Nov'}</span>
          </button>
        )}
      </div>
      <div className="flex items-baseline justify-between p-4">
        <h3 className="font-medium">{title}</h3>
        <span className="font-mono text-xs text-muted">{length}</span>
      </div>
    </article>
  );
}
