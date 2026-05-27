'use client';

import {
  Building2,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { CommandPalette, useCommandPalette } from '@/components/command-palette';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { NAV_GROUPS } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore, useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/* ─── Per-group colour system ──────────────────────────────────
   Each group maps to one of the four semantic token families.
   "dot" is used for the icon dot and active item indicator.
   "headerBg" is the tinted section header background.
   "headerText" is the header label colour when the group is active.
   "itemBg" / "itemText" are for the active nav item inside the group.
──────────────────────────────────────────────────────────────── */
type GroupColors = {
  readonly dot: string;
  readonly headerBg: string;
  readonly headerBgInactive: string;
  readonly headerText: string;
  readonly itemBg: string;
  readonly itemText: string;
};

const GROUP_COLORS: Record<string, GroupColors> = {
  'Pilotage': {
    dot: 'bg-accent',
    headerBg: 'bg-accent-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-accent-ink',
    itemBg: 'bg-accent-soft',
    itemText: 'text-accent-ink',
  },
  'Référentiel': {
    dot: 'bg-info',
    headerBg: 'bg-info-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-info-ink',
    itemBg: 'bg-info-soft',
    itemText: 'text-info-ink',
  },
  'Saisie': {
    dot: 'bg-warn',
    headerBg: 'bg-warn-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-warn-ink',
    itemBg: 'bg-warn-soft',
    itemText: 'text-warn-ink',
  },
  'Retraitement': {
    dot: 'bg-critical',
    headerBg: 'bg-critical-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-critical-ink',
    itemBg: 'bg-critical-soft',
    itemText: 'text-critical-ink',
  },
  'États': {
    dot: 'bg-accent',
    headerBg: 'bg-accent-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-accent-ink',
    itemBg: 'bg-accent-soft',
    itemText: 'text-accent-ink',
  },
  'Analyse & IA': {
    dot: 'bg-info',
    headerBg: 'bg-info-soft',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-info-ink',
    itemBg: 'bg-info-soft',
    itemText: 'text-info-ink',
  },
  'Organisation': {
    dot: 'bg-ink-mute',
    headerBg: 'bg-sunk',
    headerBgInactive: 'hover:bg-sunk',
    headerText: 'text-ink-soft',
    itemBg: 'bg-sunk',
    itemText: 'text-ink',
  },
};
const DEFAULT_COLORS = GROUP_COLORS['Organisation']!;

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const signout = useAuthStore((s) => s.signout);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  const activeGroupTitle = NAV_GROUPS.find((g) =>
    g.items.some((item) => isActive(item.href, pathname)),
  )?.title;

  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroupTitle ? [activeGroupTitle] : NAV_GROUPS.map((g) => g.title)),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleGroup = (title: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

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
      {/* ─── Topbar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-6">
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

          <button
            type="button"
            className="group flex items-center gap-2 rounded-sm border border-line-strong/60 bg-canvas px-2.5 py-1.5 text-sm text-ink transition-colors duration-fast hover:border-line-strong hover:bg-sunk"
          >
            <Building2 className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
            <span className="max-w-[100px] truncate font-medium sm:max-w-[180px]">
              {currentOrg?.name ?? 'Aucune organisation'}
            </span>
            <span className="hidden text-2xs uppercase tracking-wider text-ink-mute md:inline">
              {currentOrg?.role ?? ''}
            </span>
            <ChevronsUpDown className="h-3 w-3 text-ink-mute" strokeWidth={1.5} />
          </button>

          <span className="hidden items-center gap-1.5 rounded-xs bg-sunk px-2 py-1 text-2xs uppercase tracking-wider text-ink-soft md:inline-flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Exercice 2026
          </span>

          <div className="flex-1" />

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

      <div className="flex">
        {/* ─── Sidebar ───────────────────────────────────────────── */}
        <aside
          aria-label="Navigation principale"
          className={cn(
            'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto',
            'border-r border-line bg-paper md:flex md:flex-col',
            'transition-[width] duration-300 ease-out-quint',
            sidebarCollapsed ? 'w-[60px]' : 'w-[220px]',
          )}
        >
          {/* Sidebar toggle */}
          <div className={cn(
            'flex shrink-0 items-center border-b border-line px-2 py-2',
            sidebarCollapsed ? 'justify-center' : 'justify-between',
          )}>
            {!sidebarCollapsed && (
              <span className="pl-1 text-[9px] font-bold uppercase tracking-[0.15em] text-ink-mute">
                Menu
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-mute transition-colors duration-fast hover:bg-sunk hover:text-ink"
              title={sidebarCollapsed ? 'Déployer' : 'Réduire'}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                : <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
              }
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {NAV_GROUPS.map((group) => {
              const isOpen = openGroups.has(group.title);
              const groupHasActive = group.items.some((item) => isActive(item.href, pathname));
              const c = GROUP_COLORS[group.title] ?? DEFAULT_COLORS;

              if (sidebarCollapsed) {
                /* ── Collapsed icon rail ── */
                return (
                  <div key={group.title} className="space-y-0.5">
                    <div className="flex justify-center py-0.5">
                      <span className={cn(
                        'h-1.5 w-1.5 rounded-full transition-opacity',
                        c.dot,
                        groupHasActive ? 'opacity-100' : 'opacity-20',
                      )} />
                    </div>
                    {group.items.map((item) => {
                      const active = isActive(item.href, pathname);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={item.label}
                          className={cn(
                            'flex h-9 w-full items-center justify-center rounded-sm transition-colors duration-fast',
                            active
                              ? cn(c.itemBg, c.itemText)
                              : 'text-ink-mute hover:bg-sunk hover:text-ink',
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                        </Link>
                      );
                    })}
                  </div>
                );
              }

              /* ── Expanded view ── */
              return (
                <div key={group.title}>
                  {/* Group header — coloured when active, neutral when not */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={isOpen}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left',
                      'transition-colors duration-fast',
                      groupHasActive
                        ? cn(c.headerBg, c.headerText)
                        : cn('text-ink-mute', c.headerBgInactive),
                    )}
                  >
                    {/* Coloured indicator dot */}
                    <span className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-xs',
                      groupHasActive ? c.headerBg : 'bg-sunk',
                    )}>
                      <span className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        c.dot,
                        !groupHasActive && 'opacity-40',
                      )} />
                    </span>

                    <span className={cn(
                      'flex-1 truncate text-[10px] font-bold uppercase tracking-[0.1em]',
                      groupHasActive ? c.headerText : 'text-ink-mute',
                    )}>
                      {group.title}
                    </span>

                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 transition-transform duration-200',
                        isOpen && 'rotate-90',
                        groupHasActive ? c.headerText : 'text-ink-mute',
                      )}
                      strokeWidth={2}
                    />
                  </button>

                  {/* Animated items — CSS grid rows trick */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateRows: isOpen ? '1fr' : '0fr',
                      transition: 'grid-template-rows 260ms cubic-bezier(0.23, 1, 0.32, 1)',
                    }}
                  >
                    <ul className="min-h-0 overflow-hidden">
                      <div className="pt-0.5 pb-1.5 space-y-0.5">
                        {group.items.map((item, i) => {
                          const active = isActive(item.href, pathname);
                          const Icon = item.icon;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className={cn(
                                  'group relative flex items-start gap-2.5 rounded-sm px-2.5 py-1.5 text-sm',
                                  'transition-[transform,background-color,color] duration-fast',
                                  'hover:translate-x-0.5',
                                  active
                                    ? cn(c.itemBg, 'font-medium', c.itemText)
                                    : 'text-ink-soft hover:bg-sunk hover:text-ink',
                                )}
                                style={{ animationDelay: `${i * 40}ms` }}
                              >
                                {/* Active left indicator */}
                                {active && (
                                  <span className={cn(
                                    'absolute inset-y-1.5 left-0 w-0.5 rounded-full',
                                    c.dot,
                                  )} />
                                )}
                                <Icon
                                  className={cn(
                                    'mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors',
                                    active ? c.itemText : 'text-ink-mute group-hover:text-ink-soft',
                                  )}
                                  strokeWidth={1.5}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate leading-tight text-[13px]">
                                    {item.label}
                                  </span>
                                  {item.hint && (
                                    <span className={cn(
                                      'mt-0.5 block truncate text-[10px] leading-tight',
                                      active ? 'opacity-60' : 'text-ink-mute',
                                    )}>
                                      {item.hint}
                                    </span>
                                  )}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </div>
                    </ul>
                  </div>
                </div>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="shrink-0 border-t border-line p-3">
              <p className="text-[9px] uppercase tracking-wider text-ink-mute">Version</p>
              <p className="mt-0.5 font-mono text-xs text-ink-soft">v1.0 · wave 2</p>
            </div>
          )}
        </aside>

        {/* ─── Mobile horizontal nav ─────────────────────────────── */}
        <nav
          aria-label="Navigation mobile"
          className="sticky top-14 z-20 flex w-full gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 md:hidden"
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
                    : 'text-ink-soft hover:bg-sunk hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {group.title}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function isActive(href: string, pathname: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

function Separator() {
  return <span aria-hidden className="hidden h-5 w-px bg-line md:inline-block" />;
}
