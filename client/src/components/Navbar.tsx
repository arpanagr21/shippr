import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface Crumb {
  label: string;
  href?: string;
}

interface Props {
  crumbs?: Crumb[];
  right?: ReactNode;
}

export default function Navbar({ crumbs, right }: Props) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50 supports-[backdrop-filter]:bg-background/80">
      <div className="h-full px-6 flex items-center gap-3">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 border border-primary/20">
            <Zap className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="font-semibold text-sm">Shippr</span>
        </Link>

        {/* Breadcrumb */}
        {!isHome && crumbs && crumbs.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <nav className="flex items-center gap-1.5 text-sm min-w-0">
              {crumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <span className="text-muted-foreground/50">/</span>}
                  {crumb.href ? (
                    <Link to={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors truncate">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-foreground font-medium truncate">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </>
        )}

        {/* Right slot */}
        {right && <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>}
      </div>
    </header>
  );
}
