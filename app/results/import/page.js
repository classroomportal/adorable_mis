'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Retired: superseded by /results/import-gradebook, which handles the
// variable-column weekly gradebook export directly instead of requiring
// a fixed upn/subject_code/week_start_date/score/max_score/grade CSV.
export default function RetiredImportRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/results/import-gradebook');
  }, [router]);
  return <p>This importer has moved to <a href="/results/import-gradebook">/results/import-gradebook</a>.</p>;
}
