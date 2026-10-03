'use client';
import BudgetPanel from '../../components/BudgetPanel';

// Budget tile: Term forecast (migration 339). Only the principal while it is being built.
export default function Page() {
  return <BudgetPanel view="forecast" resourceKey="/finance/forecast" />;
}
