// SplashScreen.js
// (c) 2026 CBT. All rights reserved.
'use client';
import { useEffect, useState } from 'react';

const DISPLAY_MS = 2200;

export default function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false);

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
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <div
        style={{
          width: 'min(84vw, 380px)',
          height: 'min(84vw, 380px)',
          background: '#C0272D',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '2rem',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: -50, right: -50, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', bottom: -70, left: -70, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#C0272D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>

        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <div style={{ fontSize: '11px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.75)', marginBottom: '6px', textTransform: 'uppercase' }}>
            Every school, organised
          </div>
          <div style={{ fontSize: '24px', fontWeight: 500, color: '#ffffff' }}>Formwork</div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '6px', fontStyle: 'italic' }}>
            Esse Maximum, Esse Adoramus
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', zIndex: 1 }}>
          <div style={{ width: 20, height: 4, borderRadius: 2, background: '#ffffff' }} />
          <div style={{ width: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.4)' }} />
          <div style={{ width: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.4)' }} />
        </div>

        <div style={{ position: 'absolute', bottom: 18, fontSize: '11px', color: 'rgba(255,255,255,0.65)', zIndex: 1 }}>
          © 2026 CBT. All rights reserved.
        </div>
      </div>
    </div>
  );
}
