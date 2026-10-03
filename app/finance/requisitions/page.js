'use client';
import BudgetComingSoon from '../../components/BudgetComingSoon';

export default function Page() {
  return (
    <BudgetComingSoon resourceKey="/finance/requisitions" title="Requisitions">
      <ul>
        <li>Any member of staff raises a requisition: items, quantities, the reason and when it&apos;s needed.</li>
        <li>They follow it through each step: signed by you, costed and approved by the college secretary, supplied, paid by the bursar.</li>
        <li>Each requisition keeps a timeline of who did what and when. Nothing is deleted: a requisition is withdrawn or cancelled, with the reason recorded.</li>
      </ul>
    </BudgetComingSoon>
  );
}
