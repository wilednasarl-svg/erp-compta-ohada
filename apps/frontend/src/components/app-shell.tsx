'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  LogOut,
  Plus,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { CommandPalette, useCommandPalette } from '@/components/command-palette';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { NAV_GROUPS, type NavGroup } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore, useCurrentOrg, useCurrentUser, useOrganizations } from '@/stores/auth-store';
import type { SelectOrganizationResponse } from '@/types/auth';

/* ─── Per-group colour + meta ─────────────────────────────────── */
type GroupColors = {
  readonly dot: string;
  readonly headerBg: string;
  readonly headerText: string;
  readonly itemBg: string;
  readonly itemText: string;
  readonly iconBg: string;
  readonly description: string;
};

const GROUP_COLORS: Record<string, GroupColors> = {
  'Pilotage': {
    dot: 'bg-accent',
    headerBg: 'bg-accent-soft',
    headerText: 'text-accent-ink',
    itemBg: 'bg-accent-soft',
    itemText: 'text-accent-ink',
    iconBg: 'bg-accent-soft',
    description: "Vue d'ensemble et indicateurs de gestion",
  },
  'Référentiel': {
    dot: 'bg-info',
    headerBg: 'bg-info-soft',
    headerText: 'text-info-ink',
    itemBg: 'bg-info-soft',
    itemText: 'text-info-ink',
    iconBg: 'bg-info-soft',
    description: 'Plan comptable, périodes et devises',
  },
  'Saisie': {
    dot: 'bg-warn',
    headerBg: 'bg-warn-soft',
    headerText: 'text-warn-ink',
    itemBg: 'bg-warn-soft',
    itemText: 'text-warn-ink',
    iconBg: 'bg-warn-soft',
    description: 'Écritures, imports et workflow de validation',
  },
  'Retraitement': {
    dot: 'bg-critical',
    headerBg: 'bg-critical-soft',
    headerText: 'text-critical-ink',
    itemBg: 'bg-critical-soft',
    itemText: 'text-critical-ink',
    iconBg: 'bg-critical-soft',
    description: 'Lettrage, rapprochement et transformations',
  },
  'États': {
    dot: 'bg-accent',
    headerBg: 'bg-accent-soft',
    headerText: 'text-accent-ink',
    itemBg: 'bg-accent-soft',
    itemText: 'text-accent-ink',
    iconBg: 'bg-accent-soft',
    description: 'États financiers et déclarations fiscales',
  },
  'Analyse & IA': {
    dot: 'bg-info',
    headerBg: 'bg-info-soft',
    headerText: 'text-info-ink',
    itemBg: 'bg-info-soft',
    itemText: 'text-info-ink',
    iconBg: 'bg-info-soft',
    description: 'Scoring qualité, anomalies et automatisations',
  },
  'Organisation': {
    dot: 'bg-ink-mute',
    headerBg: 'bg-sunk',
    headerText: 'text-ink-soft',
    itemBg: 'bg-sunk',
    itemText: 'text-ink',
    iconBg: 'bg-sunk',
    description: 'Membres, documents et traçabilité',
  },
};
const DEFAULT_COLORS = GROUP_COLORS['Organisation']!;

/* ─── AppShell ─────────────────────────────────────────────────── */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const signout = useAuthStore((s) => s.signout);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on navigation */
  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  /* Close on outside click */
  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openGroup]);

  /* Close on Escape */
  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [openGroup]);

  const logout = useApiMutation(async () => {
    if (typeof refreshToken === 'string') {
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    return undefined;
  });

  const handleLogout = async (): Promise<void> => {
    await logout.mutateAsync(undefined);
    signout();
    router.replace('/login');
  };

  const userInitials = (user?.firstName ?? user?.email ?? '?')
    .split(/[ @.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="min-h-screen bg-canvas">

      {/* ─── Topbar ─────────────────────────────────────────────── */}
      <header
        aria-label="Barre principale"
        className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70"
      >
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-6">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-display text-base font-medium tracking-tight text-ink"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-xs bg-ink text-[10px] font-mono font-medium text-canvas">
              EC
            </span>
            <span className="hidden sm:inline">Compta</span>
            <span className="hidden text-2xs uppercase tracking-wider text-ink-mute sm:inline">
              · OHADA
            </span>
          </Link>

          <Separator />

          {/* Org selector */}
          <OrgSwitcher />

          {/* Exercise badge — exercice actif réel */}
          <ExerciseBadge />

          <div className="flex-1" />

          {/* Search */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-sm border border-line-strong/60 bg-canvas px-2.5 py-1.5 text-xs text-ink-mute transition-colors duration-fast hover:border-line-strong hover:bg-sunk"
            aria-label="Recherche rapide"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="hidden md:inline">Rechercher</span>
            <kbd className="hidden rounded-xs border border-line-strong bg-paper px-1 font-mono text-[10px] text-ink-soft md:inline-block">
              ⌘K
            </kbd>
          </button>

          <Separator />

          {/* User */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-2xs font-medium uppercase tracking-wider text-accent-ink"
            >
              {userInitials || '?'}
            </span>
            <div className="hidden text-right md:block">
              <div className="text-xs font-medium text-ink leading-tight">
                {user?.firstName ?? user?.email ?? '—'}
              </div>
              <div className="text-2xs text-ink-mute">{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-mute transition-colors duration-fast hover:bg-sunk hover:text-ink"
              aria-label="Déconnexion"
              title="Déconnexion"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* ─── Desktop horizontal nav ─────────────────────────────── */}
      <div
        ref={navRef}
        className="sticky top-14 z-20 hidden border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/80 md:block no-print"
      >
        <nav
          aria-label="Navigation principale"
          className="flex h-11 items-center gap-0.5 px-4"
        >
          {NAV_GROUPS.map((group) => (
            <TopNavGroup
              key={group.title}
              group={group}
              isOpen={openGroup === group.title}
              onToggle={() =>
                setOpenGroup((prev) => (prev === group.title ? null : group.title))
              }
              onClose={() => setOpenGroup(null)}
              pathname={pathname}
            />
          ))}
        </nav>
      </div>

      {/* ─── Mobile nav ─────────────────────────────────────────── */}
      <nav
        aria-label="Navigation mobile"
        className="sticky top-14 z-20 flex w-full gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 md:hidden no-print"
      >
        {NAV_GROUPS.map((group) => {
          const activeItem = group.items.find((item) => isActive(item.href, pathname));
          const active = !!activeItem;
          const target = activeItem ?? group.items[0];
          if (!target) return null;
          const Icon = target.icon;
          const c = GROUP_COLORS[group.title] ?? DEFAULT_COLORS;
          return (
            <Link
              key={group.title}
              href={target.href}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs transition-colors duration-fast',
                active
                  ? cn(c.itemBg, 'font-medium', c.itemText)
                  : 'text-ink hover:bg-sunk',
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {group.title}
            </Link>
          );
        })}
      </nav>

      {/* ─── Main ───────────────────────────────────────────────── */}
      <main className="min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
        {children}
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/* ─── TopNavGroup — trigger + mega-menu dropdown ─────────────── */
function TopNavGroup({
  group,
  isOpen,
  onToggle,
  onClose,
  pathname,
}: {
  group: NavGroup;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  pathname: string;
}) {
  const groupHasActive = group.items.some((item) => isActive(item.href, pathname));
  const c = GROUP_COLORS[group.title] ?? DEFAULT_COLORS;
  const FirstIcon = group.items[0]?.icon;

  return (
    <div className="relative">
      {/* Trigger tab */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium',
          'transition-colors duration-fast',
          groupHasActive
            ? cn(c.itemBg, c.itemText)
            : isOpen
              ? 'bg-sunk text-ink'
              : 'text-ink hover:bg-sunk',
        )}
      >
        {/* Active / color dot */}
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full transition-opacity',
            c.dot,
            groupHasActive ? 'opacity-100' : isOpen ? 'opacity-60' : 'opacity-30',
          )}
        />
        {group.title}
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-ink-mute transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
          strokeWidth={2}
        />
      </button>

      {/* Active underline */}
      {groupHasActive && (
        <span
          className={cn('absolute bottom-0 inset-x-2 h-0.5 rounded-full', c.dot)}
          aria-hidden
        />
      )}

      {/* ── Mega-menu dropdown ── */}
      {isOpen && (
        <div
          role="menu"
          className={cn(
            'absolute left-0 top-full z-50 mt-1',
            'w-[500px] overflow-hidden rounded-sm border border-line bg-paper shadow-xl',
            'animate-in fade-in-0 slide-in-from-top-1 duration-150',
          )}
        >
          <div className="flex">
            {/* Left panel — colored */}
            <div className={cn('w-[152px] shrink-0 p-4', c.headerBg)}>
              {/* Representative icon */}
              {FirstIcon && (
                <div className={cn(
                  'mb-3 inline-flex h-9 w-9 items-center justify-center rounded-sm border border-line/40',
                  c.itemBg,
                )}>
                  <FirstIcon className={cn('h-4 w-4', c.headerText)} strokeWidth={1.5} />
                </div>
              )}
              <p className={cn(
                'text-[10px] font-bold uppercase tracking-[0.12em]',
                c.headerText,
              )}>
                {group.title}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">
                {c.description}
              </p>
              <p className={cn('mt-3 text-[10px] font-medium', c.itemText)}>
                {group.items.length}&nbsp;fonctionnalité{group.items.length > 1 ? 's' : ''}
              </p>
            </div>

            {/* Right panel — 2-column item grid */}
            <div className="flex-1 p-3">
              <div className="grid grid-cols-2 gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, pathname);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={onClose}
                      className={cn(
                        'group/item flex items-start gap-2.5 rounded-xs p-2.5',
                        'transition-colors duration-fast',
                        active ? cn(c.itemBg, c.itemText) : 'hover:bg-sunk',
                      )}
                    >
                      {/* Icon badge */}
                      <div className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-xs',
                        active ? c.iconBg : 'bg-sunk group-hover/item:bg-canvas',
                      )}>
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5',
                            active ? c.itemText : 'text-ink-soft group-hover/item:text-ink',
                          )}
                          strokeWidth={1.5}
                        />
                      </div>
                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <span className={cn(
                          'block truncate text-[12px] font-medium leading-tight',
                          active ? c.itemText : 'text-ink',
                        )}>
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="mt-0.5 block truncate text-[10px] leading-tight text-ink-mute">
                            {item.hint}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────── */
/**
 * Routes exigeant une correspondance exacte : celles qui sont préfixes d'une
 * autre entrée de navigation. `startsWith` reste la règle pour les routes à
 * sous-pages.
 */
const EXACT_MATCH_ROUTES: ReadonlySet<string> = new Set([
  '/dashboard',
  '/chart-of-accounts',
]);

function isActive(href: string, pathname: string): boolean {
  return EXACT_MATCH_ROUTES.has(href) ? pathname === href : pathname.startsWith(href);
}

function Separator() {
  return <span aria-hidden className="hidden h-5 w-px bg-line md:inline-block" />;
}

/* ─── Exercice actif (pastille barre) ─────────────────────────── */

interface ShellPeriod {
  readonly id: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly parentId: string | null;
}

function ExerciseBadge() {
  const orgId = useCurrentOrg()?.id ?? '';
  const { data } = useQuery({
    queryKey: ['shell-exercise', orgId],
    queryFn: async () => {
      const resp = await api.get<{ periods: ReadonlyArray<ShellPeriod> }>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return resp.periods;
    },
    enabled: orgId !== '',
    staleTime: 300_000,
  });

  const roots = (data ?? []).filter((p) => p.parentId === null);
  if (roots.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const active =
    roots.find((p) => p.startDate.slice(0, 10) <= today && today <= p.endDate.slice(0, 10)) ??
    [...roots].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (active === undefined) return null;

  return (
    <span className="hidden items-center gap-1.5 rounded-xs bg-sunk px-2 py-1 text-2xs uppercase tracking-wider text-ink-soft md:inline-flex">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      {active.label}
    </span>
  );
}

/* ─── Org switcher — bascule de dossier ───────────────────────── */

const ORG_TINTS: ReadonlyArray<string> = [
  'bg-accent-soft text-accent-ink',
  'bg-info-soft text-info-ink',
  'bg-warn-soft text-warn-ink',
  'bg-sunk text-ink-soft',
];
function orgTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ORG_TINTS[h % ORG_TINTS.length]!;
}
function orgInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  expert_comptable: 'Expert-comptable',
  chef_mission: 'Chef de mission',
  comptable: 'Comptable',
  auditeur: 'Auditeur',
};
function roleLabel(role: string | undefined): string {
  if (!role) return '';
  return ROLE_LABEL[role] ?? role.replace(/_/g, ' ');
}

function OrgSwitcher() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const orgs = useOrganizations() ?? [];
  const setOrg = useAuthStore((s) => s.setOrg);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = useApiMutation((organizationId: string) =>
    api.post<SelectOrganizationResponse>('/auth/select-organization', { organizationId }),
  );

  async function switchTo(id: string): Promise<void> {
    if (id === currentOrg?.id) {
      setOpen(false);
      return;
    }
    try {
      const result = await select.mutateAsync(id);
      setOrg({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        organization: result.organization,
      });
      setOpen(false);
      router.replace('/dashboard');
    } catch {
      // L'erreur remonte via le toast/mutation ; on garde le menu ouvert.
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex items-center gap-2 rounded-sm border border-line-strong/60 bg-canvas px-2.5 py-1.5 text-sm text-ink transition-colors duration-fast hover:border-line-strong hover:bg-sunk"
      >
        <Building2 className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
        <span className="max-w-[100px] truncate font-medium sm:max-w-[180px]">
          {currentOrg?.name ?? 'Aucun dossier'}
        </span>
        <span className="hidden text-2xs uppercase tracking-wider text-ink-mute md:inline">
          {roleLabel(currentOrg?.role)}
        </span>
        <ChevronsUpDown className="h-3 w-3 text-ink-mute" strokeWidth={1.5} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-sm border border-line bg-paper shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          <p className="eyebrow px-3 pb-1.5 pt-2.5">Vos dossiers</p>
          <ul className="max-h-72 overflow-y-auto pb-1">
            {orgs.length === 0 ? (
              <li className="px-3 py-2 text-xs text-ink-mute">Aucun dossier disponible</li>
            ) : (
              orgs.map((o) => {
                const active = o.id === currentOrg?.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={select.isPending}
                      onClick={() => void switchTo(o.id)}
                      className={cn(
                        'press flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-sunk disabled:opacity-50',
                        active && 'bg-sunk/60',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-mono text-2xs font-semibold',
                          orgTint(o.name),
                        )}
                      >
                        {orgInitials(o.name) || <Building2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{o.name}</span>
                        <span className="block text-2xs text-ink-mute">{roleLabel(o.role)}</span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-accent-ink" strokeWidth={2} />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-line p-1">
            <Link
              href="/organizations"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-xs px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Tous les dossiers
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
