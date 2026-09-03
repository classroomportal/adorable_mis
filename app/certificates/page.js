'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

const MILESTONES = [1000, 500, 100]; // check highest first

function CertificatesInner() {
  const [pending, setPending] = useState([]);
  const [awarded, setAwarded] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(null); // { name, milestone }

  async function load() {
    setLoading(true);
    const { data: events } = await supabase.from('behaviour_events').select('student_id, points, type');
    const { data: students } = await supabase.from('students').select('student_id, first_name, last_name');
    const { data: already } = await supabase.from('certificates_awarded').select('*');

    const totals = {};
    (events || []).forEach((e) => {
      if (e.type !== 'positive' || !e.points) return;
      totals[e.student_id] = (totals[e.student_id] || 0) + e.points;
    });
    const awardedSet = new Set((already || []).map((a) => `${a.student_id}-${a.milestone}`));
    const studentMap = Object.fromEntries((students || []).map((s) => [s.student_id, s]));

    const pend = [];
    Object.entries(totals).forEach(([sid, total]) => {
      for (const m of MILESTONES) {
        if (total >= m && !awardedSet.has(`${sid}-${m}`)) {
          pend.push({ student_id: Number(sid), student: studentMap[sid], milestone: m, total });
          break; // only the highest uncollected milestone per student
        }
      }
    });
    pend.sort((a, b) => b.milestone - a.milestone || b.total - a.total);
    setPending(pend);

    const awardedWithNames = (already || [])
      .map((a) => ({ ...a, student: studentMap[a.student_id] }))
      .sort((a, b) => (b.awarded_date || '').localeCompare(a.awarded_date || ''));
    setAwarded(awardedWithNames);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markAwarded(row) {
    const { error } = await supabase.from('certificates_awarded').insert({ student_id: row.student_id, milestone: row.milestone });
    if (!error) load();
  }

  function doPrint(row) {
    setPrinting(row);
    setTimeout(() => { window.print(); }, 100);
  }

  return (
    <div>
      <div className="no-print">
        <h1>Certificates</h1>
        <p>Awarded automatically at 100, 500 and 1000 cumulative positive behaviour points.</p>

        <div className="card">
          <h2>Ready to award ({pending.length})</h2>
          {loading ? <p>Loading...</p> : pending.length === 0 ? <p>Nobody has newly crossed a milestone.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Milestone</th><th>Current total</th><th></th></tr></thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={`${row.student_id}-${row.milestone}`}>
                    <td>{row.student?.first_name} {row.student?.last_name}</td>
                    <td>{row.milestone}</td>
                    <td>{row.total}</td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => doPrint(row)}>Print certificate</button>
                      <button className="secondary" onClick={() => markAwarded(row)}>Mark awarded (no print)</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <div className="card">
          <h2>Previously awarded</h2>
          {awarded.length === 0 ? <p>None yet.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Milestone</th><th>Date</th></tr></thead>
              <tbody>
                {awarded.map((a) => (
                  <tr key={`${a.student_id}-${a.milestone}`}>
                    <td>{a.student?.first_name} {a.student?.last_name}</td>
                    <td>{a.milestone}</td>
                    <td>{a.awarded_date}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>

      {printing && (
        <div className="certificate-print">
          <div className="certificate-border">
            <p className="cert-eyebrow">Adorable British College</p>
            <h1 className="cert-title">Certificate of Achievement</h1>
            <p className="cert-body">This certificate is proudly awarded to</p>
            <p className="cert-name">{printing.student?.first_name} {printing.student?.last_name}</p>
            <p className="cert-body">for reaching <strong>{printing.milestone} positive behaviour points</strong></p>
            <p className="cert-date">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="no-print" style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button onClick={() => { markAwarded(printing); setPrinting(null); }}>Mark as awarded</button>
            <button className="secondary" onClick={() => setPrinting(null)} style={{ marginLeft: '0.5rem' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CertificatesPage() {
  return <RequireAuth><CertificatesInner /></RequireAuth>;
}
