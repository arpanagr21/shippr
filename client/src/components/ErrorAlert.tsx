import { AlertTriangle } from 'lucide-react';
import { parseApiError } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Props {
  error: string | null;
  /** compact=true for inline use inside cards; false (default) for page-level alerts */
  compact?: boolean;
  className?: string;
}

export default function ErrorAlert({ error, compact = false, className }: Props) {
  if (!error) return null;

  const { code, message } = parseApiError(error);

  if (compact) {
    return (
      <div className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2',
        className,
      )}>
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          {code && (
            <span className="text-[10px] font-semibold text-destructive/70 uppercase tracking-wide mr-1.5">
              {code}
            </span>
          )}
          <span className="text-xs text-destructive break-words">{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3',
      className,
    )}>
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        {code && (
          <span className="text-xs font-semibold text-destructive/70 uppercase tracking-wide mr-2">
            {code}
          </span>
        )}
        <span className="text-sm text-destructive break-words">{message}</span>
      </div>
    </div>
  );
}
