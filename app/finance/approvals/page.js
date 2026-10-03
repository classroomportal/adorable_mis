'use client';
import BudgetComingSoon from '../../components/BudgetComingSoon';

export default function Page() {
  return (
    <BudgetComingSoon resourceKey="/finance/approvals" title="Requisition approvals">
      <ul>
        <li><strong>To sign</strong> (you): agree the need, or reject with a reason.</li>
        <li><strong>To cost and approve</strong> (the college secretary): prices, an approved supplier and the cost centre, checked against what the cost centre has left. Approving commits the money.</li>
        <li><strong>Waiting for contingency</strong>: anything that would overspend waits until you release the shortfall from Contingency.</li>
        <li><strong>Awaiting delivery</strong> and <strong>to pay</strong> (the bursar), never more than the approved total.</li>
        <li>Nobody signs or approves their own requisition.</li>
      </ul>
    </BudgetComingSoon>
  );
}
