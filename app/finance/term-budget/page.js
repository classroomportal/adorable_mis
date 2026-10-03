'use client';
import BudgetComingSoon from '../../components/BudgetComingSoon';

export default function Page() {
  return (
    <BudgetComingSoon resourceKey="/finance/term-budget" title="Term budget">
      <ul>
        <li>Share each term&apos;s general fund out across Staffing, Power, Food, Maintenance and Contingency, planned against what has been invoiced for the term.</li>
        <li>Ring-fenced fees (swimming, sports, medical, ICT, exam entries) fund their own lines.</li>
        <li>For each cost centre: allocated, committed, spent and remaining, with how much is backed by cash collected so far.</li>
        <li>The budget and any change to it apply only when you and the college secretary have both approved them.</li>
        <li>Releases from Contingency to a cost centre that would otherwise overspend, and unspent money carried forward to the next term.</li>
      </ul>
    </BudgetComingSoon>
  );
}
