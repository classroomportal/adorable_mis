'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const DISPLAY_MS = 2800;

export default function SplashScreen({ onDone }) {
  const [photos, setPhotos] = useState([]);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    async function loadPhotos() {
      const { data } = await supabase
        .from('students')
        .select('photo_base64')
        .not('photo_base64', 'is', null)
        .limit(60);
      const all = (data || []).map((r) => r.photo_base64).filter(Boolean);
      // Shuffle client-side and take a handful for the collage.
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      setPhotos(all.slice(0, 8));
    }
    loadPhotos();
  }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), DISPLAY_MS - 400);
    const doneTimer = setTimeout(() => onDone(), DISPLAY_MS);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#f6f6f4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <img src="/logo.png" alt="Adorable British College" style={{ width: '120px', marginBottom: '1.5rem' }} />
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e34430', marginBottom: '1.5rem' }}>
        Adorable British College
      </div>
      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.5rem',
            maxWidth: '360px',
            padding: '0 1.5rem',
          }}
        >
          {photos.map((p, i) => (
            <img
              key={i}
              src={`data:image/jpeg;base64,${p}`}
              alt=""
              style={{
                width: '72px',
                height: '72px',
                objectFit: 'cover',
                borderRadius: '50%',
                border: '2px solid #e34430',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
