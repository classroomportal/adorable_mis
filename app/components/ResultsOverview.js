'use client';

// The Results page of the parent and student portals: latest grades against
// target first (what families come for), then everything they can download
// in one place, each button named after its document. Parents found the old
// layout confusing: download buttons first, an unlabelled grade table
// underneath, and every button starting with the same word.

import TermTestScoresDownload from './TermTestScoresDownload';
import KeyStageTranscriptDownload from './KeyStageTranscriptDownload';
import PublishedDocuments from './PublishedDocuments';
import SubjectsTwoColumn from './SubjectsTwoColumn';
import { STYLE, LABEL, visibleTargets } from '../../lib/gradeCompare';

const sectionHeading = { margin: '1rem 0 0.25rem', fontSize: '1rem' };
const note = { margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#5b6472' };

export default function ResultsOverview({ studentId, yearGroup = null, targets, results, gradePoints, enrolledSubjectIds, forStudent = false }) {
  const shown = visibleTargets(targets, results, enrolledSubjectIds);
  const whose = forStudent ? 'your' : 'the';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%' }}>
      <h3 style={{ ...sectionHeading, marginTop: '0.25rem' }}>Latest grades</h3>
      {shown.length === 0 ? (
        <p style={note}>No target grades set yet.</p>
      ) : (
        <>
          <p style={note}>
            The most recent grade in each subject, beside {whose} target grade.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
            {['above', 'on', 'below'].map((k) => (
              <span key={k} className="badge" style={STYLE[k]}>{LABEL[k]}</span>
            ))}
          </div>
          <SubjectsTwoColumn
            targets={targets}
            results={results}
            gradePoints={gradePoints}
            enrolledSubjectIds={enrolledSubjectIds}
            gradeHeading="Latest"
          />
        </>
      )}

      <h3 style={sectionHeading}>Reports to download</h3>
      <p style={note}>Each report is a PDF, made from the latest marks when you open it.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '1.25rem', alignItems: 'center' }}>
        <TermTestScoresDownload studentId={studentId} label="📄 Term test scores" compact />
        <KeyStageTranscriptDownload studentId={studentId} yearGroup={yearGroup} compact />
      </div>

      <h3 style={sectionHeading}>Documents from the school</h3>
      <PublishedDocuments studentId={studentId} variant="buttons" emptyNote={<p style={note}>None yet.</p>} />
    </div>
  );
}
