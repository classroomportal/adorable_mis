'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { STUDENT_NUMBER_VIEWS } from '../../../lib/studentNumberViews';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

const YEARS = [7, 8, 9, 10, 11, 12];


function genderKey(g) {
  if (g === 'M' || g === 'F') return g;
  return 'Unknown';
}

function newCounts() {
  return { M: 0, F: 0, Unknown: 0, total: 0 };
}

function addStudent(counts, gender) {
  counts[genderKey(gender)]++;
  counts.total++;
}

function CountsRow({ label, counts, years }) {
  return (
    <tr>
      <td style={tdStyle}>{label}</td>
      {years !== undefined && <td style={{ ...tdStyle, color: '#555' }}>{years}</td>}
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.M}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.F}</td>
      <td style={{ ...tdStyle, textAlign: 'center', color: counts.Unknown > 0 ? '#b45309' : '#ccc' }}>
        {counts.Unknown || ''}
      </td>
      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{counts.total}</td>
    </tr>
  );
}

function SubtotalRow({ label, counts, years }) {
  return (
    <tr style={{ background: '#f5f5f5', fontWeight: 600 }}>
      <td style={tdStyle}>{label}</td>
      {years !== undefined && <td style={tdStyle}>{years}</td>}
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.M}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.F}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.Unknown || ''}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.total}</td>
    </tr>
  );
}

function CountsTable({ title, rows, totalCounts, labelHeader, yearsColumn }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{title}</h2>
      <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={thStyle}>{labelHeader || (title.includes('Class') ? 'Class' : title.includes('Mentor') ? 'Mentor group' : 'Year')}</th>
              {yearsColumn && <th style={thStyle}>Years</th>}
              <th style={{ ...thStyle, textAlign: 'center' }}>M</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>F</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Unknown</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows}
            {totalCounts && <SubtotalRow label="All" years={yearsColumn ? '' : undefined} counts={totalCounts} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Room numbers are text ('1'…'17'); sort them as numbers, with blanks last.
function compareRooms(a, b) {
  if (a === NO_ROOM) return 1;
  if (b === NO_ROOM) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

const NO_ROOM = 'No room';
const NO_HOUSE = 'No boarding house';
const NO_RESTAURANT = 'No restaurant';
const NO_SPORTS_HOUSE = 'No sports house';

// "Y9 (3), Y10 (1)": the year groups in a room, youngest first.
function yearsLabel(yearCounts) {
  return Object.keys(yearCounts)
    .map(Number)
    .sort((a, b) => a - b)
    .map((y) => `Y${y} (${yearCounts[y]})`)
    .join(', ');
}

function ViewTabs({ view }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.25rem' }}>
      {STUDENT_NUMBER_VIEWS.map((v) => (
        <Link
          key={v.key}
          href={`/admin/student-numbers?view=${v.key}`}
          style={{
            padding: '0.35rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #ccc',
            textDecoration: 'none',
            fontSize: '0.85rem',
            background: v.key === view ? '#1e3a5f' : '#fff',
            color: v.key === view ? '#fff' : '#333',
          }}
        >
          {v.label}
        </Link>
      ))}
    </div>
  );
}

function StudentNumbersInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('view');
  const view = STUDENT_NUMBER_VIEWS.some((v) => v.key === requested) ? requested : 'years';
  const viewInfo = STUDENT_NUMBER_VIEWS.find((v) => v.key === view);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [byYear, setByYear] = useState([]);
  const [yearTotal, setYearTotal] = useState(newCounts());

  const [byMentor, setByMentor] = useState([]); // [{year_group, group_name, counts}]
  const [mentorTotal, setMentorTotal] = useState(newCounts());

  const [byHouse, setByHouse] = useState([]); // [{house, rooms:[{room, counts, years}], houseTotal, years}]
  const [houseTotal, setHouseTotal] = useState(newCounts());

  const [byRestaurant, setByRestaurant] = useState([]); // [{restaurant, counts}]
  const [restaurantTotal, setRestaurantTotal] = useState(newCounts());

  const [bySportsHouse, setBySportsHouse] = useState([]); // [{house, counts, years}]
  const [sportsHouseTotal, setSportsHouseTotal] = useState(newCounts());

  const [bySubject, setBySubject] = useState([]); // [{subject_name, classes:[{class_code, counts}], subjectTotal}]
  const [classTotal, setClassTotal] = useState(newCounts());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: students, error: sErr } = await supabase
          .from('students')
          .select('student_id, year_group, gender, form_class, status, boarding_house, boarding_room_number, restaurant, sports_house')
          .in('year_group', YEARS)
          .eq('status', 'active');
        if (sErr) throw sErr;

        // --- By year group ---
        const yearCounts = {};
        for (const y of YEARS) yearCounts[y] = newCounts();
        const yTotal = newCounts();
        for (const s of students) {
          if (yearCounts[s.year_group]) addStudent(yearCounts[s.year_group], s.gender);
          addStudent(yTotal, s.gender);
        }
        setByYear(YEARS.map((y) => ({ year_group: y, counts: yearCounts[y] })));
        setYearTotal(yTotal);

        if (view === 'years') {
        // --- By mentor group ---
        const { data: groups, error: gErr } = await supabase
          .from('mentor_groups')
          .select('mentor_group_id, group_name, year_group')
          .in('year_group', YEARS)
          .order('year_group')
          .order('group_name');
        if (gErr) throw gErr;

        const studentByFormClass = new Map();
        for (const s of students) {
          if (!s.form_class) continue;
          if (!studentByFormClass.has(s.form_class)) studentByFormClass.set(s.form_class, []);
          studentByFormClass.get(s.form_class).push(s);
        }
        const mTotal = newCounts();
        const mentorRows = (groups || []).map((g) => {
          const counts = newCounts();
          for (const s of studentByFormClass.get(g.group_name) || []) addStudent(counts, s.gender);
          for (const k of ['M', 'F', 'Unknown']) mTotal[k] += counts[k];
          mTotal.total += counts.total;
          return { year_group: g.year_group, group_name: g.group_name, counts };
        });
        setByMentor(mentorRows);
        setMentorTotal(mTotal);
        }

        if (view === 'boarding') {
        // --- By boarding house and room ---
        // Room numbers repeat across houses (every house has a room 1), so
        // rooms are counted within their house, never on the number alone.
        const houseMap = new Map(); // house -> Map(room -> {counts, years})
        const hTotal = newCounts();
        for (const s of students) {
          const house = s.boarding_house?.trim() || NO_HOUSE;
          const room = s.boarding_room_number?.trim() || NO_ROOM;
          if (!houseMap.has(house)) houseMap.set(house, new Map());
          const roomMap = houseMap.get(house);
          if (!roomMap.has(room)) roomMap.set(room, { counts: newCounts(), years: {} });
          const entry = roomMap.get(room);
          addStudent(entry.counts, s.gender);
          entry.years[s.year_group] = (entry.years[s.year_group] || 0) + 1;
          addStudent(hTotal, s.gender);
        }
        const houseRows = [...houseMap.entries()]
          .sort((a, b) => (a[0] === NO_HOUSE) - (b[0] === NO_HOUSE) || a[0].localeCompare(b[0]))
          .map(([house, roomMap]) => {
            const total = newCounts();
            const houseYears = {};
            const rooms = [...roomMap.entries()]
              .sort((a, b) => compareRooms(a[0], b[0]))
              .map(([room, { counts, years }]) => {
                for (const k of ['M', 'F', 'Unknown', 'total']) total[k] += counts[k];
                for (const [y, n] of Object.entries(years)) houseYears[y] = (houseYears[y] || 0) + n;
                return { room, counts, years: yearsLabel(years) };
              });
            return { house, rooms, houseTotal: total, years: yearsLabel(houseYears) };
          });
        setByHouse(houseRows);
        setHouseTotal(hTotal);

        // --- By restaurant ---
        const restMap = new Map();
        const rTotal = newCounts();
        for (const s of students) {
          const r = s.restaurant?.trim() || NO_RESTAURANT;
          if (!restMap.has(r)) restMap.set(r, newCounts());
          addStudent(restMap.get(r), s.gender);
          addStudent(rTotal, s.gender);
        }
        setByRestaurant(
          [...restMap.entries()]
            .sort((a, b) => (a[0] === NO_RESTAURANT) - (b[0] === NO_RESTAURANT) || a[0].localeCompare(b[0], undefined, { numeric: true }))
            .map(([restaurant, counts]) => ({ restaurant, counts })),
        );
        setRestaurantTotal(rTotal);
        }

        if (view === 'houses') {
        // --- By sports house ---
        const sportsMap = new Map(); // house -> {counts, years}
        const spTotal = newCounts();
        for (const s of students) {
          const h = s.sports_house?.trim() || NO_SPORTS_HOUSE;
          if (!sportsMap.has(h)) sportsMap.set(h, { counts: newCounts(), years: {} });
          const entry = sportsMap.get(h);
          addStudent(entry.counts, s.gender);
          entry.years[s.year_group] = (entry.years[s.year_group] || 0) + 1;
          addStudent(spTotal, s.gender);
        }
        setBySportsHouse(
          [...sportsMap.entries()]
            .sort((a, b) => (a[0] === NO_SPORTS_HOUSE) - (b[0] === NO_SPORTS_HOUSE) || a[0].localeCompare(b[0]))
            .map(([house, { counts, years }]) => ({ house, counts, years })),
        );
        setSportsHouseTotal(spTotal);

        // --- By class (every subject class, all years) ---
        // student_class has 4500+ rows school-wide, well past Supabase's default
        // 1000-row response cap, so this has to page through with .range() or it
        // silently truncates and every class's count comes out wrong.
        const links = [];
        const PAGE_SIZE = 1000;
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: page, error: lErr } = await supabase
            .from('student_class')
            .select('student_id, classes(class_code, subjects(subject_name))')
            .range(from, from + PAGE_SIZE - 1);
          if (lErr) throw lErr;
          links.push(...page);
          if (page.length < PAGE_SIZE) break;
        }

        const studentById = new Map(students.map((s) => [s.student_id, s]));
        const bySubjectMap = new Map(); // subject_name -> Map(class_code -> counts)
        const cTotal = newCounts();
        for (const link of links || []) {
          const s = studentById.get(link.student_id);
          if (!s) continue; // not an active Y7-12 student
          const subjectName = link.classes?.subjects?.subject_name || 'Unassigned';
          const classCode = link.classes?.class_code || 'Unknown';
          if (!bySubjectMap.has(subjectName)) bySubjectMap.set(subjectName, new Map());
          const classMap = bySubjectMap.get(subjectName);
          if (!classMap.has(classCode)) classMap.set(classCode, newCounts());
          addStudent(classMap.get(classCode), s.gender);
          addStudent(cTotal, s.gender);
        }
        const subjectRows = [...bySubjectMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([subjectName, classMap]) => ({
            subjectName,
            classes: [...classMap.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([class_code, counts]) => ({ class_code, counts })),
          }));
        setBySubject(subjectRows);
        setClassTotal(cTotal);
        }
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [view]);

  if (loading) return <div style={{ padding: '1rem' }}>Loading…</div>;

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>Student Numbers: {viewInfo.label}</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1rem' }}>
        Active students, Years 7–12. {viewInfo.desc}
      </p>

      <ViewTabs view={view} />

      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      {view === 'years' && (
        <>
          <CountsTable
            title="By Year Group"
            totalCounts={yearTotal}
            rows={byYear.map((r) => (
              <CountsRow key={r.year_group} label={`Year ${r.year_group}`} counts={r.counts} />
            ))}
          />

          <CountsTable
            title="By Mentor Group"
            labelHeader="Mentor group"
            totalCounts={mentorTotal}
            rows={byYear.flatMap((y) => {
              const groups = byMentor.filter((r) => r.year_group === y.year_group);
              if (groups.length === 0) return [];
              const sub = newCounts();
              for (const g of groups) for (const k of ['M', 'F', 'Unknown', 'total']) sub[k] += g.counts[k];
              return [
                ...groups.map((r) => (
                  <CountsRow key={r.year_group + r.group_name} label={r.group_name} counts={r.counts} />
                )),
                <SubtotalRow key={`y${y.year_group}`} label={`Year ${y.year_group}`} counts={sub} />,
              ];
            })}
          />
          <p style={{ color: '#777', fontSize: '0.8rem', marginTop: '-1.5rem' }}>
            A student without a mentor group is counted in their year but not in any mentor group.
          </p>
        </>
      )}

      {view === 'boarding' && (
        <>
          <CountsTable
            title="By Restaurant"
            labelHeader="Restaurant"
            totalCounts={restaurantTotal}
            rows={byRestaurant.map((r) => (
              <CountsRow
                key={r.restaurant}
                label={r.restaurant === NO_RESTAURANT ? r.restaurant : `Restaurant ${r.restaurant}`}
                counts={r.counts}
              />
            ))}
          />

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>By Boarding House and Room</h2>
            {byHouse.map((h) => (
              <details key={h.house} style={{ marginBottom: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '0.3rem 0' }}>
                  {h.house}{' '}
                  <span style={{ fontWeight: 400, color: '#555' }}>
                    — {h.houseTotal.total} students, {h.rooms.filter((r) => r.room !== NO_ROOM).length} rooms · {h.years}
                  </span>
                </summary>
                <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6, marginTop: '0.3rem' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5' }}>
                        <th style={thStyle}>Room</th>
                        <th style={thStyle}>Years</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>M</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>F</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Unknown</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.rooms.map((r) => (
                        <CountsRow
                          key={r.room}
                          label={r.room === NO_ROOM ? r.room : `Room ${r.room}`}
                          years={r.years}
                          counts={r.counts}
                        />
                      ))}
                      <SubtotalRow label="All" years={h.years} counts={h.houseTotal} />
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
            <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>
              All houses — M {houseTotal.M} · F {houseTotal.F}
              {houseTotal.Unknown ? ` · Unknown ${houseTotal.Unknown}` : ''} · {houseTotal.total}
            </div>
          </div>
        </>
      )}

      {view === 'houses' && (
        <>
          <CountsTable
            title="By Sports House"
            labelHeader="Sports house"
            yearsColumn
            totalCounts={sportsHouseTotal}
            rows={bySportsHouse.map((r) => (
              <CountsRow key={r.house} label={r.house} years={yearsLabel(r.years)} counts={r.counts} />
            ))}
          />

          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>By Class</h2>
            {bySubject.map((subj) => (
              <details key={subj.subjectName} style={{ marginBottom: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '0.3rem 0' }}>{subj.subjectName}</summary>
                <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6, marginTop: '0.3rem' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5' }}>
                        <th style={thStyle}>Class</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>M</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>F</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Unknown</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subj.classes.map((c) => (
                        <CountsRow key={c.class_code} label={c.class_code} counts={c.counts} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
            <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>
              Total class enrolments (each student counted once per class they're in) — M {classTotal.M} · F {classTotal.F}
              {classTotal.Unknown ? ` · Unknown ${classTotal.Unknown}` : ''} · {classTotal.total}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle = {
  padding: '0.5rem',
  textAlign: 'left',
  borderBottom: '1px solid #ddd',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #eee',
  whiteSpace: 'nowrap',
};

export default function StudentNumbersPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/student-numbers">
        <Suspense fallback={<div style={{ padding: '1rem' }}>Loading…</div>}>
          <StudentNumbersInner />
        </Suspense>
      </RequireResource>
    </RequireAuth>
  );
}
