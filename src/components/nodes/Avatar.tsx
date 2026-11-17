import { memo, useEffect, useRef, useState, type Ref } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
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
  loading?: 'eager' | 'lazy';
  ref?: Ref<HTMLDivElement>;
}

/**
 * Portrait with graceful fallback. Fills its parent and inherits its radius.
 * The gradient backdrop is always painted so a slow image never flashes empty.
 */
export const Avatar = memo(function Avatar({ src, name, color, alt = '', className, loading = 'eager', ref }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== '' && failedSrc !== src;

  return (
    <div ref={ref} className={cx('sc-avatar', className)} style={{ backgroundImage: fallbackGradient(color) }}>
      {showImage ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          loading={loading}
          width={200}
          height={200}
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

/**
 * Graph-node portrait that requests AniList's 100×150 `medium` file while `hiResImages` is false
 * and upgrades to the 230×345 `large` file once `hiResImages` is true and the portrait has been
 * seen near the viewport. Any non-matching URL is passed through unchanged.
 */
export const NodeAvatar = memo(function NodeAvatar(props: AvatarProps) {
  const hi = useGraphStore((s) => s.hiResImages);
  const hasObserver = typeof IntersectionObserver !== 'undefined';
  const [seenHiRes, setSeenHiRes] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hi || seenHiRes || !hasObserver) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeenHiRes(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hi, seenHiRes, hasObserver]);

  const useLarge = hi && (!hasObserver || seenHiRes);
  const src = useLarge ? props.src : props.src.replace(/\/(character|staff)\/large\//, '/$1/medium/');
  return <Avatar {...props} ref={ref} src={src} />;
});
