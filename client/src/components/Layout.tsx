import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Zap, LayoutDashboard, ChevronRight, Users, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface Crumb {
  label: string;
  href?: string;
}

interface Props {
  children:    ReactNode;
  crumbs?:     Crumb[];
  navRight?:   ReactNode;
  fullHeight?: boolean;
}

function NavItem({
  to,
  icon: Icon,
  label,
  exact = false,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  exact?: boolean;
}) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

export default function Layout({ children, crumbs, navRight, fullHeight }: Props) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'super_admin';

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-card/40">
        {/* Brand */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-border shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shrink-0">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight truncate">Shippr</p>
            <p className="text-[10px] text-muted-foreground/70 leading-tight">Coolify</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Navigation
          </p>
          <NavItem to="/" icon={LayoutDashboard} label="Dashboard" exact />
          {isAdmin && (
            <NavItem to="/users" icon={Users} label="Users" />
          )}
        </nav>

        {/* User footer */}
        <div className="shrink-0 border-t border-border p-3 space-y-2">

          {/* Attribution */}
          <div className="px-1 space-y-0.5">
            <p className="text-[10px] text-muted-foreground/40 leading-tight">
              crafted by - <span className="text-muted-foreground/60">arpan agrawal</span>
            </p>
            <p className="text-[10px] text-muted-foreground/30 leading-tight">💧 stay hydrated</p>
          </div>

          {user && (
            <div className="flex items-center gap-2.5 px-1">
              {user.photoUrl ? (
                <img src={user.photoUrl} className="h-7 w-7 rounded-full shrink-0" alt="" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted border shrink-0 text-xs font-medium">
                  {user.email[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user.name ?? user.email.split('@')[0]}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────── */}
      <div className={cn('flex flex-1 flex-col min-w-0', fullHeight && 'overflow-hidden')}>

        {/* Page header */}
        <header className="h-14 shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center justify-between gap-4 px-6">
          {crumbs && crumbs.length > 0 ? (
            <nav className="flex items-center gap-1 text-sm min-w-0">
              {crumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                  {crumb.href ? (
                    <Link
                      to={crumb.href}
                      className="text-muted-foreground hover:text-foreground transition-colors truncate"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground truncate">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          ) : (
            <div />
          )}

          {navRight && (
            <div className="flex items-center gap-2 shrink-0">{navRight}</div>
          )}
        </header>

        {/* Scrollable content */}
        <main
          className={cn(
            'flex-1',
            fullHeight ? 'overflow-hidden flex flex-col min-h-0' : 'overflow-auto',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
