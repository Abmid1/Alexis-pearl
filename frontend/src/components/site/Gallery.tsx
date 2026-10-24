'use client';
import { useState } from 'react';
import { I } from '@/components/Icons';
import { Placeholder } from './PropertyCard';

/** Responsive gallery: main image, arrow/keyboard navigation, thumbnail strip. */
export default function Gallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="s-gallery-main"><Placeholder text="The agency hasn't added photos yet" /></div>;
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length);
  return (
    <div className="s-gallery" role="region" aria-roledescription="carousel" aria-label={`Photos of ${title}`}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); }}>
      <div className="s-gallery-main">
        <img src={images[i]} alt={`${title} — photo ${i + 1} of ${images.length}`} decoding="async" />
        {images.length > 1 && (
          <>
            <span className="s-gallery-count" aria-live="polite">{i + 1} / {images.length}</span>
            <div className="s-gallery-nav">
              <button type="button" onClick={() => go(-1)} aria-label="Previous photo"><I name="chevronLeft" size={20} /></button>
              <button type="button" onClick={() => go(1)} aria-label="Next photo"><I name="chevronRight" size={20} /></button>
            </div>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="s-thumbs">
          {images.map((src, n) => (
            <button type="button" key={src + n} aria-current={n === i} aria-label={`Show photo ${n + 1}`} onClick={() => setI(n)}>
              <img src={src} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
