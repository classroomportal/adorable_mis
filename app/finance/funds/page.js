'use client';
import BudgetPanel from '../../components/BudgetPanel';

// Budget tile: Which fund each fee item pays into, and the cost centres (migration 338). Only the principal while it is being built.
export default function Page() {
  return <BudgetPanel view="funds" resourceKey="/finance/funds" />;
}
