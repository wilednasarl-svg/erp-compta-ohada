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

type GroupColorScheme = {
  readonly dot: string;
  readonly text: string;
  readonly bg: string;
  readonly border: string;
};

const GROUP_COLORS: Record<string, GroupColorScheme> = {
  'Pilotage':     { dot: 'bg-accent',   text: 'text-accent-ink',   bg: 'bg-accent-soft',   border: 'border-accent/30' },
  'Référentiel':  { dot: 'bg-info',     text: 'text-info-ink',     bg: 'bg-info-soft',     border: 'border-info/30' },
  'Saisie':       { dot: 'bg-warn',     text: 'text-warn-ink',     bg: 'bg-warn-soft',     border: 'border-warn/30' },
  'Retraitement': { dot: 'bg-critical', text: 'text-critical-ink', bg: 'bg-critical-soft', border: 'border-critical/30' },
  'États':        { dot: 'bg-accent',   text: 'text-accent-ink',   bg: 'bg-accent-soft',   border: 'border-accent/30' },
  'Analyse & IA': { dot: 'bg-info',     text: 'text-info-ink',     bg: 'bg-info-soft',     border: 'border-info/30' },
  'Organisation': { dot: 'bg-ink-mute', text: 'text-ink-soft',     bg: 'bg-sunk',          border: 'border-line-strong' },
};

const DEFAULT_COLORS: GroupColorScheme = {
  dot: 'bg-ink-mute', text: 'text-ink-soft', bg: 'bg-sunk', border: 'border-line-strong',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const signout = useAuthStore((s) => s.signout);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  const activeGroupTitle = NAV_GROUPS.find((g) =>
    g.items.some((item) =>
      item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href),
    ),
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

  const isItemActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-canvas">
      {/* ─── Topbar ────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-6">
          {/* Wordmark */}
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

      {/* ─── Body ──────────────────────────────────────────── */}
      <div className="flex">
        {/* ─── Sidebar ───────────────────────────────────────── */}
        <aside
          aria-label="Navigation principale"
          className={cn(
            'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto border-r border-line bg-paper md:flex md:flex-col',
            'transition-[width] duration-300 ease-out-quint',
            sidebarCollapsed ? 'w-14' : 'w-60',
          )}
        >
          {/* Toggle button row */}
          <div className={cn(
            'flex items-center border-b border-line py-2 shrink-0',
            sidebarCollapsed ? 'justify-center px-1' : 'justify-between px-3',
          )}>
            {!sidebarCollapsed && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-mute">
                Navigation
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-xs text-ink-mute transition-colors duration-fast hover:bg-sunk hover:text-ink"
              title={sidebarCollapsed ? 'Déployer le menu' : 'Réduire le menu'}
              aria-label={sidebarCollapsed ? 'Déployer le menu' : 'Réduire le menu'}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                : <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
              }
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-2">
            {NAV_GROUPS.map((group) => {
              const isOpen = openGroups.has(group.title);
              const groupHasActive = group.items.some((item) => isItemActive(item.href));
              const colors = GROUP_COLORS[group.title] ?? DEFAULT_COLORS;

              return (
                <div key={group.title} className={cn('mb-0.5', sidebarCollapsed ? 'px-1' : 'px-2')}>
                  {sidebarCollapsed ? (
                    /* Collapsed — dot separator + icon rail */
                    <>
                      <div className="flex items-center justify-center py-1">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full transition-opacity duration-fast',
                            colors.dot,
                            groupHasActive ? 'opacity-100' : 'opacity-25',
                          )}
                        />
                      </div>
                      <ul className="space-y-0.5">
                        {group.items.map((item) => {
                          const active = isItemActive(item.href);
                          const Icon = item.icon;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                title={item.label}
                                className={cn(
                                  'flex h-8 w-full items-center justify-center rounded-sm transition-colors duration-fast',
                                  active
                                    ? cn(colors.bg, colors.text)
                                    : 'text-ink-mute hover:bg-sunk hover:text-ink',
                                )}
                              >
                                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    /* Expanded — colored group header + animated items */
                    <>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.title)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xs px-2 py-1.5 transition-colors duration-fast hover:bg-sunk',
                        )}
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full transition-opacity duration-fast',
                              colors.dot,
                              groupHasActive ? 'opacity-100' : 'opacity-35',
                            )}
                          />
                          <span
                            className={cn(
                              'text-[10px] font-semibold uppercase tracking-wider transition-colors duration-fast',
                              groupHasActive ? colors.text : 'text-ink-mute',
                            )}
                          >
                            {group.title}
                          </span>
                        </div>
                        <ChevronRight
                          className={cn(
                            'h-3 w-3 shrink-0 transition-transform duration-200',
                            isOpen ? 'rotate-90' : '',
                            groupHasActive ? colors.text : 'text-ink-mute',
                          )}
                          strokeWidth={2}
                        />
                      </button>

                      {/* Animated group items via CSS grid rows */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: isOpen ? '1fr' : '0fr',
                          transition: 'grid-template-rows 240ms cubic-bezier(0.23, 1, 0.32, 1)',
                        }}
                      >
                        <ul className="overflow-hidden min-h-0 mt-0.5 mb-1.5 space-y-0.5">
                          {group.items.map((item) => {
                            const active = isItemActive(item.href);
                            const Icon = item.icon;
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  className={cn(
                                    'group relative flex items-start gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors duration-fast',
                                    active
                                      ? cn(colors.bg, 'font-medium', colors.text)
                                      : 'text-ink-soft hover:bg-sunk hover:text-ink',
                                  )}
                                >
                                  {active && (
                                    <span
                                      className={cn(
                                        'absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full',
                                        colors.dot,
                                      )}
                                    />
                                  )}
                                  <Icon
                                    className={cn(
                                      'mt-0.5 h-4 w-4 shrink-0 transition-colors',
                                      active
                                        ? colors.text
                                        : 'text-ink-mute group-hover:text-ink-soft',
                                    )}
                                    strokeWidth={1.5}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate leading-tight">{item.label}</span>
                                    {item.hint && (
                                      <span
                                        className={cn(
                                          'mt-0.5 block truncate text-[10px] leading-tight',
                                          active ? 'opacity-55' : 'text-ink-mute',
                                        )}
                                      >
                                        {item.hint}
                                      </span>
                                    )}
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          {!sidebarCollapsed && (
            <div className="shrink-0 border-t border-line p-4">
              <p className="text-2xs uppercase tracking-wider text-ink-mute">Version</p>
              <p className="mt-0.5 font-mono text-xs text-ink-soft">v1.0 · wave 2</p>
            </div>
          )}
        </aside>

        {/* Mobile horizontal nav */}
        <nav
          aria-label="Navigation mobile"
          className="sticky top-14 z-20 flex w-full gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 md:hidden"
        >
          {NAV_GROUPS.map((group) => {
            const activeItem = group.items.find((item) => isItemActive(item.href));
            const active = !!activeItem;
            const target = activeItem ?? group.items[0];
            if (!target) return null;
            const Icon = target.icon;
            const colors = GROUP_COLORS[group.title] ?? DEFAULT_COLORS;
            return (
              <Link
                key={group.title}
                href={target.href}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs transition-colors duration-fast',
                  active
                    ? cn(colors.bg, 'font-medium', colors.text)
                    : 'text-ink-soft hover:bg-sunk hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {group.title}
              </Link>
            );
          })}
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="hidden h-5 w-px bg-line md:inline-block" />;
}
