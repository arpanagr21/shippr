import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Resolves a Coolify status string (e.g. "running:healthy", "exited:0") to
// its display colour and label.  Coolify emits "<base>:<qualifier>" pairs;
// we key off the base first, then refine by qualifier where it matters.

interface Resolved {
  badge: string;
  dot:   string;
  label: string;
}

function resolve(raw: string): Resolved {
  const [base, qualifier = ''] = raw.toLowerCase().split(':');

  const label = qualifier
    ? `${base}: ${qualifier}`
    : base.replace(/_/g, ' ');

  // ── running ──────────────────────────────────────────────
  if (base === 'running') {
    if (qualifier === 'unhealthy') {
      return {
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        dot:   'bg-amber-400',
        label,
      };
    }
    if (qualifier === 'starting' || qualifier === 'restarting') {
      return {
        badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        dot:   'bg-blue-400 animate-pulse',
        label,
      };
    }
    // healthy or no qualifier
    return {
      badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      dot:   'bg-emerald-400',
      label,
    };
  }

  // ── exited ───────────────────────────────────────────────
  if (base === 'exited') {
    const code = parseInt(qualifier, 10);
    if (!isNaN(code) && code !== 0) {
      return {
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        dot:   'bg-red-400',
        label,
      };
    }
    // exit code 0 = clean stop
    return {
      badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
      dot:   'bg-slate-500',
      label,
    };
  }

  // ── restarting ───────────────────────────────────────────
  if (base === 'restarting') {
    return {
      badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      dot:   'bg-blue-400 animate-pulse',
      label,
    };
  }

  // ── deployment-specific ──────────────────────────────────
  if (base === 'in_progress' || base === 'queued') {
    return {
      badge: base === 'in_progress'
        ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
        : 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dot: base === 'in_progress' ? 'bg-blue-400 animate-pulse' : 'bg-amber-400 animate-pulse',
      label,
    };
  }
  if (base === 'finished') {
    return {
      badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      dot:   'bg-emerald-400',
      label,
    };
  }
  if (base === 'failed') {
    return {
      badge: 'bg-red-500/15 text-red-400 border-red-500/30',
      dot:   'bg-red-400',
      label,
    };
  }
  if (base === 'cancelled') {
    return {
      badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
      dot:   'bg-slate-500',
      label,
    };
  }
  if (base === 'degraded') {
    return {
      badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dot:   'bg-amber-400',
      label,
    };
  }
  if (base === 'stopped') {
    return {
      badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
      dot:   'bg-slate-500',
      label,
    };
  }

  // ── fallback ─────────────────────────────────────────────
  return {
    badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    dot:   'bg-slate-500',
    label: raw || 'unknown',
  };
}

interface Props {
  status:    string;
  className?: string;
}

export default function StatusBadge({ status, className }: Props) {
  const { badge, dot, label } = resolve(status);
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium capitalize', badge, className)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} />
      {label}
    </Badge>
  );
}
