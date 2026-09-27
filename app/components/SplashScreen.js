// SplashScreen.js
// (c) 2026 CBT. All rights reserved.
'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const DISPLAY_MS = 2200;
// How long to wait for the birthday lookup before closing without it.
const MAX_WAIT_MS = 5000;
const FADE_MS = 400;
const BIRTHDAY_RED = '#c8102e';

// Today's birthdays (migration 213) are shown here rather than on /login:
// the login page is public, and a child's date of birth is a parent's first
// password. todays_birthdays() returns names only, for signed-in staff and
// students; parents and anyone else get nothing back.
//
// Two separate screens, one after the other:
//   1. the Formwork card, exactly as on any other day, for the usual 2.2s;
//   2. on a birthday day only, the birthday names on their own, large and
//      with a red border, until someone presses Continue. Nothing closes
//      them on a timer, and a tap elsewhere doesn't either.
//
// The card doesn't move on until the lookup has answered (at most 5s). It
// used to give up after 1.8s, and on iPhones and iPads the answer often
// came later, so the names were never seen.
export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('card'); // 'card' | 'birthdays'
  const [fading, setFading] = useState(false);
  const [birthdays, setBirthdays] = useState(null); // null = still asking
  const [gaveUp, setGaveUp] = useState(false);
  const mountedAt = useRef(Date.now());
  // The dashboard passes a new onDone on every render; keep the latest in a
  // ref so a re-render doesn't restart the timer.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('todays_birthdays')
      .then(({ data }) => { if (!cancelled) setBirthdays(data || []); })
      .catch(() => { if (!cancelled) setBirthdays([]); });
    const giveUp = setTimeout(() => { if (!cancelled) setGaveUp(true); }, MAX_WAIT_MS);
    return () => { cancelled = true; clearTimeout(giveUp); };
  }, []);

  const hasBirthdays = birthdays && birthdays.length > 0;
  const answered = birthdays !== null || gaveUp;

  // Screen 1: keep the card up for 2.2s from opening (longer if the lookup
  // is slow), fade it out, then go to the birthdays or close.
  useEffect(() => {
    if (!answered || phase !== 'card') return undefined;
    const elapsed = Date.now() - mountedAt.current;
    const displayMs = Math.max(DISPLAY_MS - elapsed, FADE_MS);
    setFading(false);
    const fadeTimer = setTimeout(() => setFading(true), displayMs - FADE_MS);
    const nextTimer = setTimeout(() => {
      if (hasBirthdays) {
        setPhase('birthdays');
        setFading(false);
      } else {
        onDoneRef.current();
      }
    }, displayMs);
    return () => { clearTimeout(fadeTimer); clearTimeout(nextTimer); };
  }, [answered, hasBirthdays, phase]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#f6f6f4',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>{'@keyframes birthday-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }'}</style>
      {phase === 'card' && (
        <div
          style={{
            width: 'min(84vw, 380px)',
            height: 'min(84vw, 380px)',
            flexShrink: 0,
            opacity: fading ? 0 : 1,
            transition: `opacity ${FADE_MS}ms ease`,
            background: '#2F6FA8',
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
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#2F6FA8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      )}

      {phase === 'birthdays' && (
        <div
          role="status"
          style={{
            width: 'min(92vw, 560px)',
            background: '#ffffff',
            border: `5px solid ${BIRTHDAY_RED}`,
            borderRadius: '24px',
            padding: '32px 24px',
            boxSizing: 'border-box',
            textAlign: 'center',
            boxShadow: '0 12px 40px rgba(200, 16, 46, 0.18)',
            animation: 'birthday-pop 0.5s ease',
          }}
        >
          <div style={{ fontSize: '64px', lineHeight: 1 }}>🎂</div>
          <div style={{ fontWeight: 800, fontSize: '30px', color: BIRTHDAY_RED, margin: '14px 0 4px' }}>
            Happy Birthday!
          </div>
          <div style={{ fontSize: '17px', color: '#5b6472', marginBottom: '18px' }}>
            Celebrating today
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '45vh', overflowY: 'auto' }}>
            {birthdays.map((b, i) => (
              <li key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid #eee' : 'none' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#1f2933' }}>
                  {b.first_name} {b.last_name}
                </div>
                <div style={{ fontSize: '16px', color: '#5b6472' }}>
                  {b.person_type === 'staff' ? 'Staff' : (b.form_class || 'Student')}
                </div>
              </li>
            ))}
          </ul>
          {/* A real button, not text: some phones (iPhones especially) don't
              treat a tap on plain text as a click. */}
          <button
            type="button"
            onClick={() => onDoneRef.current()}
            style={{
              marginTop: '24px',
              padding: '14px 40px',
              fontSize: '18px',
              fontWeight: 700,
              background: BIRTHDAY_RED,
              borderColor: BIRTHDAY_RED,
              color: '#ffffff',
              borderRadius: '12px',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
