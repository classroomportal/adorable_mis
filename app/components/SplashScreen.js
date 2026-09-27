// SplashScreen.js
// (c) 2026 CBT. All rights reserved.
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const DISPLAY_MS = 2200;
// Long enough to read a handful of names; a tap dismisses it sooner.
const BIRTHDAY_DISPLAY_MS = 7000;

// Today's birthdays (migration 213) are shown here rather than on /login:
// the login page is public, and a child's date of birth is a parent's first
// password. todays_birthdays() returns names only, for signed-in staff and
// students; parents and anyone else get nothing back.
export default function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false);
  const [birthdays, setBirthdays] = useState(null); // null = still asking
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('todays_birthdays').then(({ data }) => {
      if (cancelled) return;
      setBirthdays(data || []);
      setAsked(true);
    });
    // Don't hold the splash up if the database is slow to answer.
    const giveUp = setTimeout(() => { if (!cancelled) setAsked(true); }, DISPLAY_MS - 400);
    return () => { cancelled = true; clearTimeout(giveUp); };
  }, []);

  const hasBirthdays = birthdays && birthdays.length > 0;
  // On a birthday day the Formwork card shrinks so the names are the focus.
  const compact = hasBirthdays;

  useEffect(() => {
    if (!asked) return undefined;
    const displayMs = hasBirthdays ? BIRTHDAY_DISPLAY_MS : DISPLAY_MS;
    const fadeTimer = setTimeout(() => setFading(true), displayMs - 400);
    const doneTimer = setTimeout(() => onDone(), displayMs);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [asked, hasBirthdays, onDone]);

  return (
    <div
      onClick={() => onDone()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#f6f6f4',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        padding: '16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: hasBirthdays ? 'pointer' : 'default',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <div
        style={{
          width: compact ? 'min(56vw, 210px)' : 'min(84vw, 380px)',
          height: compact ? 'min(56vw, 210px)' : 'min(84vw, 380px)',
          flexShrink: 0,
          background: '#2F6FA8',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? '8px' : '16px',
          padding: compact ? '1rem' : '2rem',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: -50, right: -50, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', bottom: -70, left: -70, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

        <div
          style={{
            width: compact ? 46 : 80,
            height: compact ? 46 : 80,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <svg width={compact ? 22 : 38} height={compact ? 22 : 38} viewBox="0 0 24 24" fill="none" stroke="#2F6FA8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>

        <div style={{ textAlign: 'center', zIndex: 1 }}>
          {!compact && (
            <div style={{ fontSize: '11px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.75)', marginBottom: '6px', textTransform: 'uppercase' }}>
              Every school, organised
            </div>
          )}
          <div style={{ fontSize: compact ? '18px' : '24px', fontWeight: 500, color: '#ffffff' }}>Formwork</div>
          <div style={{ fontSize: compact ? '10px' : '12px', color: 'rgba(255,255,255,0.7)', marginTop: compact ? '3px' : '6px', fontStyle: 'italic' }}>
            Esse Maximum, Esse Adoramus
          </div>
        </div>

        {!compact && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', zIndex: 1 }}>
            <div style={{ width: 20, height: 4, borderRadius: 2, background: '#ffffff' }} />
            <div style={{ width: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.4)' }} />
            <div style={{ width: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.4)' }} />
          </div>
        )}

        <div style={{ position: 'absolute', bottom: compact ? 10 : 18, fontSize: compact ? '9px' : '11px', color: 'rgba(255,255,255,0.65)', zIndex: 1 }}>
          © 2026 CBT. All rights reserved.
        </div>
      </div>

      {hasBirthdays && (
        <div
          role="status"
          style={{
            width: 'min(84vw, 380px)',
            background: '#ffffff',
            border: '2px solid #f0b429',
            borderRadius: '16px',
            padding: '14px 18px',
            boxSizing: 'border-box',
            textAlign: 'center',
            animation: 'birthday-pop 0.5s ease',
          }}
        >
          <style>{'@keyframes birthday-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }'}</style>
          <div style={{ fontSize: '28px', lineHeight: 1 }}>🎂</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#1f2933', margin: '6px 0 8px' }}>
            Happy birthday today to
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '15px', color: '#1f2933', maxHeight: '30vh', overflowY: 'auto' }}>
            {birthdays.map((b, i) => (
              <li key={i} style={{ padding: '2px 0' }}>
                {b.first_name} {b.last_name}
                <span style={{ color: '#5b6472', fontSize: '13px' }}>
                  {' '}— {b.person_type === 'staff' ? 'staff' : (b.form_class || 'student')}
                </span>
              </li>
            ))}
          </ul>
          {/* A real button, not text: some phones (iPhones especially) don't
              treat a tap on plain text as a click, so tapping did nothing. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDone(); }}
            style={{ marginTop: '12px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
