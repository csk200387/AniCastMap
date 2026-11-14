import { memo, useState } from 'react';
import { cx, fallbackGradient, initialsOf } from './nodeTheme';

export interface AvatarProps {
  /** Image URL; '' renders the initials fallback. */
  src: string;
  /** Name used for initials (prefer romanised `name.full` for 2-letter initials). */
  name: string;
  /** Seed colour for the fallback gradient (usually the anime colour). */
  color: string;
  alt?: string;
  className?: string;
}

/**
 * Portrait with graceful fallback. Fills its parent and inherits its radius.
 * The gradient backdrop is always painted so a slow image never flashes empty.
 */
export const Avatar = memo(function Avatar({ src, name, color, alt = '', className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== '' && failedSrc !== src;

  return (
    <div className={cx('sc-avatar', className)} style={{ backgroundImage: fallbackGradient(color) }}>
      {showImage ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="sc-initials" aria-hidden="true">
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
});
