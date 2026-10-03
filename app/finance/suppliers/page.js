'use client';
import BudgetComingSoon from '../../components/BudgetComingSoon';

export default function Page() {
  return (
    <BudgetComingSoon resourceKey="/finance/suppliers" title="Approved suppliers">
      <ul>
        <li>Requisitions can only be costed with, and paid to, a supplier on this list.</li>
        <li>A supplier is proposed with contact details and bank details, and approved by you and the college secretary together.</li>
        <li>Changing an approved supplier&apos;s bank details sends it back for approval.</li>
        <li>Suppliers are suspended or archived, never deleted. The British Council is on the list from the start, for exam entries.</li>
      </ul>
    </BudgetComingSoon>
  );
}
