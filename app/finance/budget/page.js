'use client';
import BudgetPanel from '../../components/BudgetPanel';

// Budget tile: Fee income by fund (migration 338). Only the principal while it is being built.
export default function Page() {
  return <BudgetPanel view="income" resourceKey="/finance/budget" />;
}
