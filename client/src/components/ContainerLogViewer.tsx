import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronsDown, Copy, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ErrorAlert from '@/components/ErrorAlert';
import { pollContainerLogs, type ContainerLogLine } from '@/api';

const POLL_INTERVAL_MS = 1500;
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
    const ease = 1 - Math.pow(1 - p, 3);
    el.scrollTop = start + distance * ease;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

type LineClass = { text: string; bg?: string };

function classifyLine(line: string, type?: 'stdout' | 'stderr'): LineClass {
  const t = line.trimStart();
  if (!t) return { text: 'text-slate-600' };

  if (
    /^(error|err|failed)[:\s]/i.test(t) ||
    /\b(ERROR|FAILED|FAIL|FATAL|CRITICAL|PANIC)\b/i.test(line) ||
    /✗|✘/.test(line)
  ) return { text: 'text-red-400', bg: 'bg-red-500/5' };

  if (
    /^(warn|warning)[:\s]/i.test(t) ||
    /\b(WARN|WARNING|DEPRECATED)\b/i.test(line)
  ) return { text: 'text-yellow-400' };

  if (
    /^(success|successfully|done|finished|complete|passed)[:\s!]/i.test(t) ||
    /\b(SUCCESS|DONE)\b/.test(line) ||
    /✓|✔|√/.test(line)
  ) return { text: 'text-emerald-400' };

  if (/^(\+|>\s|\$\s)/.test(t)) return { text: 'text-violet-400' };

  if (/^(info|debug|verbose)[:\s]/i.test(t) || /\bINFO\b/.test(line)) {
    return { text: 'text-blue-400' };
  }

  if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return { text: 'text-slate-400' };

  if (type === 'stderr') return { text: 'text-red-400', bg: 'bg-red-500/5' };

  return { text: 'text-slate-300' };
}

interface Props {
  containerId: string;
}

export default function ContainerLogViewer({ containerId }: Props) {
  const [lines, setLines]           = useState<ContainerLogLine[]>([]);
  const [running, setRunning]       = useState<boolean | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount]     = useState(0);
  const [copied, setCopied]         = useState(false);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef    = useRef<ContainerLogLine[]>([]);
  const cancelledRef  = useRef(false);
  const autoScrollRef = useRef(true);
  const nextSinceRef  = useRef(0);

  const drain = useCallback(() => {
    if (cancelledRef.current || pendingRef.current.length === 0) {
      drainTimerRef.current = null;
      return;
    }
    const batch = pendingRef.current.splice(0, DRAIN_BATCH);
    setLines((prev) => [...prev, ...batch]);
    if (!autoScrollRef.current) setNewCount((n) => n + batch.length);
    drainTimerRef.current = setTimeout(drain, DRAIN_MS);
  }, []);

  const enqueue = useCallback((newLines: ContainerLogLine[]) => {
    pendingRef.current.push(...newLines);
    if (!drainTimerRef.current) drainTimerRef.current = setTimeout(drain, DRAIN_MS);
  }, [drain]);

  const poll = useCallback(async () => {
    if (cancelledRef.current) return;
    const start = Date.now();
    try {
      const result = await pollContainerLogs(containerId, nextSinceRef.current);
      if (cancelledRef.current) return;

      if (result.lines.length > 0) {
        enqueue(result.lines);
        nextSinceRef.current = result.nextSince;
      }

      setRunning(result.running);

      if (!result.running) return;
    } catch (err) {
      if (!cancelledRef.current) setError(String(err));
      return;
    }

    if (!cancelledRef.current) {
      const elapsed = Date.now() - start;
      const wait    = Math.max(0, POLL_INTERVAL_MS - elapsed);
      timerRef.current = setTimeout(() => void poll(), wait);
    }
  }, [containerId, enqueue]);

  useEffect(() => {
    setLines([]);
    setRunning(null);
    setError(null);
    setAutoScroll(true);
    setNewCount(0);
    autoScrollRef.current = true;
    nextSinceRef.current  = 0;
    pendingRef.current    = [];
    cancelledRef.current  = false;

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
        <div className="flex items-center gap-2.5">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            running === null  && 'bg-muted text-muted-foreground',
            running === true  && 'bg-emerald-500/15 text-emerald-400',
            running === false && 'bg-slate-500/15 text-slate-400',
          )}>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              running === null  && 'bg-muted-foreground',
              running === true  && 'bg-emerald-400 animate-pulse',
              running === false && 'bg-slate-500',
            )} />
            {running === null ? 'connecting…' : running ? 'running' : 'stopped'}
          </span>
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
        {lines.length === 0 && running !== false && !error && (
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

        {running === true && lines.length > 0 && (
          <div className="flex gap-4 mt-1 px-1">
            <span className="w-8 shrink-0" />
            <span className="text-emerald-400 animate-pulse">▊</span>
          </div>
        )}

        {running === false && (
          <div className="flex gap-4 mt-2 px-1">
            <span className="w-8 shrink-0" />
            <span className="text-muted-foreground text-xs">— container stopped —</span>
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
