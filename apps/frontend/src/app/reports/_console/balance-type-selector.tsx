'use client';

/**
 * Sélecteur « Type de balance » (avant / après inventaire) + bandeau
 * d'avertissement — extrait de `balance-upload-console.tsx` pour rester sous la
 * limite de 800 lignes. Composant contrôlé : reçoit la valeur et le callback.
 *
 * En SYSCOHADA, seul un bilan / compte de résultat établi sur une balance après
 * inventaire est certifiable ; ce sélecteur conditionne l'étiquetage des états.
 */

import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

export type BalanceInventoryType = 'avant-inventaire' | 'apres-inventaire';

const OPTIONS = [
  {
    value: 'apres-inventaire',
    label: 'Balance après inventaire',
    description:
      'Tous les travaux de clôture ont été passés : amortissements (28x), dépréciations (29x/39x/49x/59x), régularisations (476/477/408/418), provision IS (444), variations de stocks (603/73x). Cette balance peut servir à établir les états financiers définitifs.',
    badge: {
      text: 'États certifiables',
      color: 'bg-[oklch(0.93_0.08_145)] text-[oklch(0.35_0.14_145)]',
    },
  },
  {
    value: 'avant-inventaire',
    label: 'Balance avant inventaire',
    description:
      "Les écritures d'inventaire n'ont pas encore été passées. Le bilan et le CR générés sont incomplets et non certifiables : les amortissements, dépréciations et régularisations sont absents. Utiliser uniquement pour simulation ou état intermédiaire.",
    badge: {
      text: 'États provisoires',
      color: 'bg-[oklch(0.94_0.06_55)] text-[oklch(0.42_0.14_55)]',
    },
  },
] as const;

interface BalanceTypeSelectorProps {
  readonly value: BalanceInventoryType;
  readonly onChange: (value: BalanceInventoryType) => void;
}

export function BalanceTypeSelector({ value, onChange }: BalanceTypeSelectorProps) {
  return (
    <>
      {/* ── Type de balance — information critique ── */}
      <div className="rounded-md border border-line bg-paper">
        <div className="border-b border-line px-4 py-3">
          <p className="font-display text-sm font-medium tracking-tight text-ink">
            Type de balance{' '}
            <span className="ml-1 text-[oklch(0.45_0.18_25)] text-xs font-normal">
              (obligatoire — conditionne la validité des états)
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            En SYSCOHADA, un bilan et un compte de résultat ne peuvent être certifiés que sur une
            balance après inventaire. Précisez le type pour que les états générés soient correctement
            étiquetés.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
          {OPTIONS.map(({ value: optionValue, label, description, badge }) => {
            const isSelected = value === optionValue;
            return (
              <button
                key={optionValue}
                type="button"
                onClick={() => onChange(optionValue)}
                className={cn(
                  'flex flex-col items-start gap-2 bg-paper px-4 py-4 text-left transition-colors',
                  isSelected
                    ? 'bg-accent-soft/40 ring-2 ring-inset ring-accent/40'
                    : 'hover:bg-sunk/40',
                )}
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        isSelected ? 'border-accent bg-accent' : 'border-line-strong bg-paper',
                      )}
                    >
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span
                      className={cn('text-sm font-medium', isSelected ? 'text-ink' : 'text-ink-soft')}
                    >
                      {label}
                    </span>
                  </div>
                  <span
                    className={cn('shrink-0 rounded-sm px-2 py-0.5 text-2xs font-medium', badge.color)}
                  >
                    {badge.text}
                  </span>
                </div>
                <p className="pl-6.5 text-xs leading-relaxed text-ink-mute">{description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bandeau d'avertissement avant inventaire */}
      {value === 'avant-inventaire' && (
        <div className="flex items-start gap-3 rounded-md border border-[oklch(0.75_0.12_55)] bg-[oklch(0.97_0.03_55)] px-4 py-3.5">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.50_0.15_55)]"
            strokeWidth={1.5}
          />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-[oklch(0.38_0.12_55)]">
              Balance avant inventaire — états provisoires
            </p>
            <p className="text-xs text-[oklch(0.45_0.10_55)]">
              Les états générés ci-dessous sont <strong>incomplets</strong> : les dotations aux
              amortissements, les dépréciations, les charges et produits constatés d&apos;avance, les
              charges à payer, les produits à recevoir, la provision IS et les variations de stocks ne
              figurent pas encore dans la balance. Le bilan et le CR ne sont{' '}
              <strong>pas certifiables</strong> en l&apos;état. Passez les écritures d&apos;inventaire,
              puis régénérez à partir d&apos;une balance après inventaire.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
