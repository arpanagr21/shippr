import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronsDown, Copy, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import StatusBadge from './StatusBadge';
import ErrorAlert from './ErrorAlert';
import { pollLogs, type LogLine } from '@/api';

const POLL_INTERVAL_MS = 800;
const DRAIN_MS         = 25;
const DRAIN_BATCH      = 2;

function scrollToBottom(el: HTMLElement, duration = 320) {
  const start    = el.scrollTop;
  const end      = el.scrollHeight - el.clientHeight;
  const distance = end - start;
  if (distance <= 0) return;
  const t0 = performance.now();
  const step = (now: number) => {
    const p    = Math.min((now - t0) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.scrollTop = start + distance * ease;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

type LineClass = { text: string; bg?: string };

function classifyLine(line: string, type?: 'stdout' | 'stderr'): LineClass {
  const t = line.trimStart();

  // Empty / whitespace-only
  if (!t) return { text: 'text-slate-600' };

  // Docker registry pull progress — dim these (they come on stderr but aren't errors)
  // e.g. "aa4584b052df: Pulling fs layer", "1.0.12: Pulling from org/image", "Digest: sha256:..."
  if (
    /^[a-f0-9]{7,16}: (Pull(ing)?|Download(ing)?|Already exists|Verifying|Extract(ing)?|Wait(ing)?|Push(ed)?|Mount(ed)?|Layer already)/i.test(t) ||
    /^\S+: Pulling from \S+/i.test(t) ||
    /^(Digest|Status): /.test(t)
  ) return { text: 'text-slate-500' };

  // Errors
  if (
    /^(error|err|failed)[:\s]/i.test(t) ||
    /\b(ERROR|FAILED|FAIL|FATAL|CRITICAL|PANIC)\b/i.test(line) ||
    /✗|✘/.test(line)
  ) return { text: 'text-red-400', bg: 'bg-red-500/5' };

  // Warnings
  if (
    /^(warn|warning)[:\s]/i.test(t) ||
    /\b(WARN|WARNING|DEPRECATED)\b/i.test(line)
  ) return { text: 'text-yellow-400' };

  // Success
  if (
    /^(success|successfully|done|finished|complete|passed)[:\s!]/i.test(t) ||
    /\b(SUCCESS|DONE)\b/.test(line) ||
    /✓|✔|√/.test(line)
  ) return { text: 'text-emerald-400' };

  // Docker build steps / section headers
  if (
    /^step\s+\d+\/\d+/i.test(t) ||
    /^#\d+\s/i.test(t) ||
    /^={3,}|^-{3,}/.test(t)
  ) return { text: 'text-cyan-400' };

  // Commands being executed
  if (/^(\+|>\s|\$\s)/.test(t)) return { text: 'text-violet-400' };

  // Info / debug markers
  if (/^(info|debug|verbose)[:\s]/i.test(t) || /\bINFO\b/.test(line)) {
    return { text: 'text-blue-400' };
  }

  // Timestamps or log prefixes like "[2024-01-01]" or "2024-01-01T"
  if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return { text: 'text-slate-400' };

  // stderr fallback — only for lines that didn't match any pattern above
  if (type === 'stderr') return { text: 'text-red-400', bg: 'bg-red-500/5' };

  // Default
  return { text: 'text-slate-300' };
}

interface Props {
  deploymentUuid: string;
  appUuid: string;
  onDone?: () => void;
}

export default function LogViewer({ deploymentUuid, appUuid, onDone }: Props) {
  const [lines, setLines]       = useState<LogLine[]>([]);
  const [status, setStatus]     = useState('queued');
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount]     = useState(0);
  const [copied, setCopied]         = useState(false);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);

  const containerRef   = useRef<HTMLDivElement>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const totalRef       = useRef(0);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef     = useRef<LogLine[]>([]);
  const cancelledRef   = useRef(false);
  const autoScrollRef  = useRef(true);
  const onDoneRef      = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const drain = useCallback(() => {
    if (cancelledRef.current || pendingRef.current.length === 0) {
      drainTimerRef.current = null;
      return;
    }
    const batch = pendingRef.current.splice(0, DRAIN_BATCH);
    setLines((prev) => [...prev, ...batch]);
    if (!autoScrollRef.current) {
      setNewCount((n) => n + batch.length);
    }
    drainTimerRef.current = setTimeout(drain, DRAIN_MS);
  }, []);

  const enqueue = useCallback((newLines: LogLine[]) => {
    pendingRef.current.push(...newLines);
    if (!drainTimerRef.current) {
      drainTimerRef.current = setTimeout(drain, DRAIN_MS);
    }
  }, [drain]);

  const poll = useCallback(async () => {
    if (cancelledRef.current) return;
    const start = Date.now();
    try {
      const result = await pollLogs(deploymentUuid, appUuid, totalRef.current);
      if (cancelledRef.current) return;

      if (result.lines.length > 0) {
        enqueue(result.lines);
        totalRef.current = result.total;
      }

      setStatus(result.status);

      if (result.done) {
        setDone(true);
        onDoneRef.current?.();
        return;
      }
    } catch (err) {
      if (!cancelledRef.current) setError(String(err));
      return;
    }

    if (!cancelledRef.current) {
      // Schedule next poll at a fixed interval from when this one started,
      // so a slow request doesn't push the next poll further and further out.
      const elapsed = Date.now() - start;
      const wait    = Math.max(0, POLL_INTERVAL_MS - elapsed);
      timerRef.current = setTimeout(() => void poll(), wait);
    }
  }, [deploymentUuid, appUuid, enqueue]);

  useEffect(() => {
    // Reset on new deployment
    setLines([]);
    setStatus('queued');
    setDone(false);
    setError(null);
    setAutoScroll(true);
    setNewCount(0);
    autoScrollRef.current = true;
    totalRef.current     = 0;
    pendingRef.current   = [];
    cancelledRef.current = false;

    // Fetch immediately, then poll
    void poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current)      clearTimeout(timerRef.current);
      if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    };
  }, [poll]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [lines, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    autoScrollRef.current = atBottom;
    setAutoScroll(atBottom);
    if (atBottom) setNewCount(0);
  }, []);

  function handleCopy() {
    void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyLine(text: string, i: number) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedLine(i);
      setTimeout(() => setCopiedLine(null), 1500);
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0 rounded-lg border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-card border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground tabular-nums">{lines.length} lines</span>
        </div>

        <div className="flex items-center gap-2">
          {!autoScroll && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                autoScrollRef.current = true;
                setAutoScroll(true);
                setNewCount(0);
                if (containerRef.current) scrollToBottom(containerRef.current);
              }}
            >
              <ChevronsDown className="h-3.5 w-3.5" />
              {newCount > 0 ? `${newCount} new lines` : 'Jump to bottom'}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={lines.length === 0}
                onClick={handleCopy}
              >
                {copied
                  ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" />
                  : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? 'Copied!' : 'Copy logs'}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Log area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="log-scroll flex-1 overflow-y-auto bg-black/60 p-4 font-mono text-xs leading-5"
      >
        {lines.length === 0 && !done && !error && (
          <span className="text-muted-foreground animate-pulse text-xs">Waiting for logs…</span>
        )}

        {lines.map((line, i) => {
          const { text, bg } = classifyLine(line.text, line.type);
          return (
            <div
              key={i}
              className={cn('flex gap-4 items-start group hover:bg-white/[0.02] px-1 rounded-sm -mx-1', bg)}
            >
              <span className="text-muted-foreground/30 select-none w-8 text-right shrink-0 pt-px tabular-nums">
                {i + 1}
              </span>
              <span className={cn('whitespace-pre-wrap break-all min-w-0 flex-1', text)}>
                {line.text || ' '}
              </span>
              <button
                onClick={() => handleCopyLine(line.text, i)}
                tabIndex={-1}
                className={cn(
                  'shrink-0 opacity-0 group-hover:opacity-100',
                  'inline-flex items-center justify-center rounded-md h-6',
                  'transition-all duration-200 ease-out text-xs font-medium select-none',
                  copiedLine === i
                    ? 'opacity-100 w-auto gap-1 px-2 bg-emerald-500/15 text-emerald-400'
                    : 'w-6 hover:bg-white/10 hover:scale-110 active:scale-95 text-muted-foreground/40 hover:text-muted-foreground',
                )}
              >
                {copiedLine === i ? (
                  <><CheckCheck className="h-3.5 w-3.5 shrink-0" /><span>Copied</span></>
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          );
        })}

        {!done && lines.length > 0 && (
          <div className="flex gap-4 mt-1 px-1">
            <span className="w-8 shrink-0" />
            <span className="text-emerald-400 animate-pulse">▊</span>
          </div>
        )}

        {done && lines.length > 0 && (
          <div className="flex gap-4 mt-2 px-1">
            <span className="w-8 shrink-0" />
            <span className="text-muted-foreground text-xs">— deployment {status} —</span>
          </div>
        )}

        {error && (
          <div className="mt-3 mx-1">
            <ErrorAlert error={error} compact />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
