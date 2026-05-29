'use client';

import { useState } from 'react';

/**
 * Mémoire de la dernière période Du/Au saisie, partagée entre les panneaux
 * d'états (`/reports`). Comme un seul panneau est monté à la fois (changer
 * de mode démonte le précédent), un simple singleton de module suffit :
 * pas besoin de Context Provider ni de réactivité inter-panneaux.
 *
 * Au montage, un panneau lit `getLastPeriod()` → les dates choisies sur
 * l'état précédent sont reprises. Toute modification est écrite dans le
 * store, donc reportée sur l'état suivant. Réinitialisé au rechargement.
 */

export interface ReportPeriod {
  readonly fromDate: string;
  readonly toDate: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const yearStartIso = (): string => `${new Date().getFullYear()}-01-01`;

let lastPeriod: ReportPeriod = { fromDate: yearStartIso(), toDate: todayIso() };

export const getLastPeriod = (): ReportPeriod => lastPeriod;
export const setLastPeriod = (next: ReportPeriod): void => {
  lastPeriod = next;
};

/**
 * Hook d'état de période persistée : initialise depuis le store partagé et
 * y écrit à chaque changement. Renvoie le couple `[period, setPeriod]`,
 * compatible direct avec `onChange` de `PeriodFilter`.
 */
export function usePersistedPeriod(): readonly [ReportPeriod, (next: ReportPeriod) => void] {
  const [period, setPeriodState] = useState<ReportPeriod>(getLastPeriod);

  const setPeriod = (next: ReportPeriod): void => {
    setLastPeriod(next);
    setPeriodState(next);
  };

  return [period, setPeriod] as const;
}
