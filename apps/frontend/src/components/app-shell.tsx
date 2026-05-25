'use client';

import { ArrowRightLeft, BarChart3, BookOpen, BookText, Building2, Calendar, FileUp, GitBranch, History, LayoutDashboard, LogOut, Mail, Paperclip, Percent, ShieldCheck, Sparkles, User as UserIcon, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuthStore, useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/**
 * `AppShell` — shared layout for every authenticated route (dashboard,
 * members, invitations, settings). Encapsulates:
 *
 *   - top nav with org name + user email + logout
 *   - left rail with the tenant-scoped routes
 *   - the `<main>` slot that hosts each page's body
 *
 * Kept as a client component because it reads from the Zustand auth
 * store and owns the logout mutation. Page bodies remain free to
 * mix server and client components as needed.
 */
interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/chart-of-accounts', label: 'Plan comptable', icon: BookOpen },
  { href: '/accounting-periods', label: 'Périodes', icon: Calendar },
  { href: '/imports', label: 'Imports', icon: FileUp },
  { href: '/journals', label: 'Journaux', icon: BookText },
  { href: '/reports', label: 'États financiers', icon: BarChart3 },
  { href: '/tva', label: 'TVA', icon: Percent },
  { href: '/documents', label: 'Documents', icon: Paperclip },
  { href: '/transformations', label: 'Transformations', icon: ArrowRightLeft },
  { href: '/rules', label: 'Règles', icon: Sparkles },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/audit-logs', label: 'Audit', icon: History },
  { href: '/members', label: 'Membres', icon: Users },
  { href: '/invitations', label: 'Invitations', icon: Mail },
  { href: '/settings/mfa', label: 'MFA', icon: ShieldCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const signout = useAuthStore((s) => s.signout);

  const logout = useApiMutation(async () => {
    if (typeof refreshToken === 'string') {
      // Best-effort: a network error here just means the access token
      // expires naturally; the local session is cleared either way.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    return undefined;
  });

  const handleLogout = async (): Promise<void> => {
    await logout.mutateAsync(undefined);
    signout();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {currentOrg?.name ?? 'Organisation'}
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden items-center gap-2 text-muted-foreground sm:flex">
              <UserIcon className="h-4 w-4" />
              {user?.email ?? '—'}
            </span>
            <Button size="sm" variant="outline" onClick={() => void handleLogout()}>
              <LogOut className="mr-2 h-3.5 w-3.5" /> Déconnexion
            </Button>
          </div>
        </div>
      </header>

      <div className="container grid gap-6 py-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Navigation principale" className="md:sticky md:top-6 md:self-start">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
            {NAV.map((item) => {
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
                      'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
