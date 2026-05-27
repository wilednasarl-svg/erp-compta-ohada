'use client';

import { Building2, ChevronRight, ChevronsUpDown, LogOut, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { CommandPalette, useCommandPalette } from '@/components/command-palette';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { NAV_GROUPS } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore, useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/**
 * `AppShell` — authenticated layout.
 *
 *   ┌── topbar ────────────────────────────────────────────────┐
 *   │ wordmark · org switcher · period chip · ⌘K · user menu   │
 *   ├── sidebar ──────┬── main ─────────────────────────────────┤
 *   │ grouped by      │                                         │
 *   │ domain          │  page content (full width)              │
 *   │ 240px fixed     │                                         │
 *   └─────────────────┴─────────────────────────────────────────┘
 *
 * Visual direction follows DESIGN.md: paper-ivory tones, editorial
 * serif reserved for page H1s (handled by individual pages), tabular
 * figures via globals.css, accent green only on active/CTA states.
 */
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
      {/* ─── Topbar ────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="flex h-14 items-center gap-4 px-6">
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

          {/* Org switcher (placeholder UI — full switcher lands with Module 1 polish) */}
          <button
            type="button"
            className="group flex items-center gap-2 rounded-sm border border-line-strong/60 bg-canvas px-2.5 py-1.5 text-sm text-ink transition-colors duration-fast hover:border-line-strong hover:bg-sunk"
          >
            <Building2 className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
            <span className="max-w-[200px] truncate font-medium">
              {currentOrg?.name ?? 'Aucune organisation'}
            </span>
            <span className="hidden text-2xs uppercase tracking-wider text-ink-mute md:inline">
              {currentOrg?.role ?? ''}
            </span>
            <ChevronsUpDown className="h-3 w-3 text-ink-mute" strokeWidth={1.5} />
          </button>

          {/* Active period chip (placeholder until period selector ships) */}
          <span className="hidden items-center gap-1.5 rounded-xs bg-sunk px-2 py-1 text-2xs uppercase tracking-wider text-ink-soft md:inline-flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Exercice 2026
          </span>

          <div className="flex-1" />

          {/* Search trigger — opens ⌘K palette */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-sm border border-line-strong/60 bg-canvas px-2.5 py-1.5 text-xs text-ink-mute transition-colors duration-fast hover:border-line-strong hover:bg-sunk"
            aria-label="Recherche rapide"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="hidden sm:inline">Rechercher</span>
            <kbd className="hidden rounded-xs border border-line-strong bg-paper px-1 font-mono text-[10px] text-ink-soft sm:inline-block">
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
        {/* Sidebar */}
        <aside
          aria-label="Navigation principale"
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line bg-paper md:block"
        >
          <nav className="py-3">
            {NAV_GROUPS.map((group) => {
              const isOpen = openGroups.has(group.title);
              const groupHasActive = group.items.some((item) =>
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href),
              );
              return (
                <div key={group.title} className="mb-0.5 px-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xs px-2 py-1.5 transition-colors duration-fast',
                      'hover:bg-sunk',
                      groupHasActive ? 'text-accent-ink' : 'text-ink-mute hover:text-ink-soft',
                    )}
                    aria-expanded={isOpen}
                  >
                    <span
                      className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider',
                        groupHasActive ? 'text-accent-ink' : 'text-ink-mute',
                      )}
                    >
                      {group.title}
                    </span>
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 transition-transform duration-fast',
                        isOpen ? 'rotate-90' : '',
                        groupHasActive ? 'text-accent-ink/70' : 'text-ink-mute',
                      )}
                      strokeWidth={2}
                    />
                  </button>

                  {isOpen && (
                    <ul className="mt-0.5 mb-2 space-y-0.5">
                      {group.items.map((item) => {
                        const active =
                          item.href === '/dashboard'
                            ? pathname === '/dashboard'
                            : pathname.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={cn(
                                'group relative flex items-start gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors duration-fast',
                                active
                                  ? "bg-accent-soft font-medium text-accent-ink before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-accent before:content-['']"
                                  : 'text-ink-soft hover:bg-sunk hover:text-ink',
                              )}
                            >
                              <Icon
                                className={cn(
                                  'mt-0.5 h-4 w-4 shrink-0 transition-colors',
                                  active
                                    ? 'text-accent-ink'
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
                                      active ? 'text-accent-ink/60' : 'text-ink-mute',
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
                  )}
                </div>
              );
            })}
          </nav>

          <div className="border-t border-line p-4">
            <p className="text-2xs uppercase tracking-wider text-ink-mute">Version</p>
            <p className="mt-0.5 font-mono text-xs text-ink-soft">v1.0 · wave 2</p>
          </div>
        </aside>

        {/* Mobile horizontal nav — one chip per domain group */}
        <nav
          aria-label="Navigation mobile"
          className="sticky top-14 z-20 flex w-full gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 md:hidden"
        >
          {NAV_GROUPS.map((group) => {
            const activeItem = group.items.find((item) =>
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href),
            );
            const active = !!activeItem;
            const target = activeItem ?? group.items[0];
            if (!target) return null;
            const Icon = target.icon;
            return (
              <Link
                key={group.title}
                href={target.href}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs transition-colors duration-fast',
                  active
                    ? 'bg-accent-soft font-medium text-accent-ink'
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
        <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="hidden h-5 w-px bg-line md:inline-block" />;
}
