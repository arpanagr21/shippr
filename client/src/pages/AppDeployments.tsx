import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, ScrollText, Rocket, Clock, CheckCircle2, XCircle, Box, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorAlert from '@/components/ErrorAlert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Layout from '@/components/Layout';
import StatusBadge from '@/components/StatusBadge';
import { getAppDeployments, triggerAppDeploy } from '@/api';
import type { Deployment } from '@/types';
import type { DeploymentsPage } from '@/api';
import { cn } from '@/lib/utils';

const PAGE_LIMIT = 10;

function deployDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const secs = Math.floor((end - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatCard({
  icon: Icon,
  iconClass,
  value,
  label,
}: {
  icon: React.ElementType;
  iconClass?: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Icon className={cn('h-4 w-4 shrink-0', iconClass ?? 'text-muted-foreground')} />
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function AppDeployments() {
  const { uuid } = useParams<{ uuid: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const appName = (location.state as { appName?: string } | null)?.appName ?? uuid ?? 'App';

  const [page, setPage]             = useState<DeploymentsPage | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const [bgChecking, setBgChecking] = useState(false);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePolling      = useRef(false);
  const bgCheckTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgCheckInFlight  = useRef(false);
  // Tracks whether the first immediate background check after a cache-hit has been fired.
  // Reset when the user navigates to a different app or page.
  const bgCheckDoneRef   = useRef(false);

  // Debounce search input
  function handleSearchChange(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setCurrentPage(1);
    }, 300);
  }

  const load = useCallback(async (pg: number, bust = false) => {
    if (!uuid) return;
    bust ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const data = await getAppDeployments(uuid, pg, PAGE_LIMIT, bust);
      setPage(data);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uuid]);

  // Reset background-check state whenever the user switches app or page
  useEffect(() => { bgCheckDoneRef.current = false; }, [uuid, currentPage]);

  useEffect(() => { void load(currentPage, false); }, [load, currentPage]);

  const hasLive = (page?.data ?? []).some(
    (d) => d.status === 'in_progress' || d.status === 'queued',
  );

  // 1s live-poll while any deployment on this page is in progress
  useEffect(() => {
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    if (!hasLive) return;

    liveTimerRef.current = setTimeout(() => {
      if (livePolling.current) return;
      livePolling.current = true;
      void load(currentPage, true).finally(() => { livePolling.current = false; });
    }, 1000);

    return () => { if (liveTimerRef.current) clearTimeout(liveTimerRef.current); };
  }, [page, currentPage, load, hasLive]);

  // When no in-progress deployment is visible: fire one immediate background hard-reset,
  // then keep checking every 60 s so newly-triggered deployments surface automatically.
  useEffect(() => {
    if (bgCheckTimerRef.current) clearTimeout(bgCheckTimerRef.current);

    // Live-poll handles the in-progress case; skip during initial load too.
    if (hasLive || loading || page === null) return;

    // First check after a cache load: fire quickly. Subsequent: every 60 s.
    const delay = bgCheckDoneRef.current ? 60_000 : 500;
    bgCheckDoneRef.current = true; // mark so the next cycle uses 60 s

    bgCheckTimerRef.current = setTimeout(async () => {
      if (bgCheckInFlight.current) return;
      bgCheckInFlight.current = true;
      setBgChecking(true);
      try {
        const data = await getAppDeployments(uuid!, currentPage, PAGE_LIMIT, true);
        setPage(data);
      } catch { /* silent — user can always hit Refresh manually */ }
      finally {
        bgCheckInFlight.current = false;
        setBgChecking(false);
      }
    }, delay);

    return () => { if (bgCheckTimerRef.current) clearTimeout(bgCheckTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, loading, hasLive]);

  async function handleDeploy() {
    if (!uuid || deploying) return;
    setDeploying(true);
    setDeployError(null);
    try {
      await triggerAppDeploy(uuid);
      // Jump to page 1 and hard-refresh so the new in_progress deployment appears immediately
      setCurrentPage(1);
      await load(1, true);
    } catch (err) {
      setDeployError(String(err).replace('Error: ', ''));
    } finally {
      setDeploying(false);
    }
  }

  if (!uuid) return null;

  // Client-side filter on current page by uuid prefix or status
  const deployments: Deployment[] = (page?.data ?? []).filter((d) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return d.uuid.toLowerCase().includes(q) || d.status.toLowerCase().includes(q);
  });

  const total      = page?.total ?? 0;
  const totalPages = page?.totalPages ?? 1;
  const from       = ((currentPage - 1) * PAGE_LIMIT) + 1;
  const to         = Math.min(currentPage * PAGE_LIMIT, total);

  const succeeded  = (page?.data ?? []).filter((d) => d.status === 'finished').length;
  const failed     = (page?.data ?? []).filter((d) => d.status === 'failed').length;
  const inProgress = (page?.data ?? []).filter((d) => d.status === 'in_progress' || d.status === 'queued').length;

  return (
    <Layout
      crumbs={[
        { label: 'Dashboard', href: '/' },
        { label: appName },
      ]}
      navRight={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(currentPage, true)}
            disabled={refreshing || loading}
            className="gap-2 h-8"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => void handleDeploy()}
            disabled={deploying}
            className="gap-2 h-8"
          >
            {deploying
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Rocket className="h-3.5 w-3.5" />}
            {deploying ? 'Deploying…' : 'Deploy Now'}
          </Button>
        </div>
      }
    >
      <div className="max-w-7xl mx-auto w-full px-6 py-8 space-y-7">

        {/* App identity */}
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border shrink-0">
            <Box className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{appName}</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{uuid}</p>
          </div>
        </div>

        {/* Stats */}
        {!loading && total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Rocket}       value={total}      label="Total"       />
            <StatCard icon={CheckCircle2} iconClass="text-emerald-400" value={succeeded} label="Succeeded" />
            <StatCard icon={XCircle}      iconClass="text-red-400"     value={failed}    label="Failed"    />
            <StatCard icon={Loader2}      iconClass="text-blue-400"    value={inProgress} label="In Progress" />
          </div>
        )}

        <ErrorAlert error={error ?? deployError} />

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && total === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted border">
              <Rocket className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">No deployments yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {bgChecking ? 'Checking for live deployments…' : 'Trigger a deploy to start seeing history here.'}
              </p>
            </div>
            {bgChecking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}

        {/* Table + controls */}
        {!loading && total > 0 && (
          <div className="space-y-3">
            {/* Search + pagination info row */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by status or ID…"
                  className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {bgChecking && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking live…
                  </span>
                )}
                {page?.cachedAt && !loading && !bgChecking && (
                  <span className="text-xs text-muted-foreground">
                    cached {new Date(page.cachedAt).toLocaleTimeString()}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {total > 0 ? `${from}–${to} of ${total}` : ''}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border">
                    <TableHead>Status</TableHead>
                    <TableHead>Commit</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deployments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No deployments match your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    deployments.map((d) => {
                      const isLive = d.status === 'in_progress' || d.status === 'queued';
                      return (
                        <TableRow
                          key={d.uuid}
                          className="group cursor-pointer"
                          onClick={() => navigate(`/deployments/${d.uuid}`, { state: { appName, appUuid: uuid } })}
                        >
                          <TableCell><StatusBadge status={d.status} /></TableCell>

                          <TableCell className="max-w-[260px]">
                            {d.commit ? (
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <code className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded w-fit">
                                  {d.commit.slice(0, 7)}
                                </code>
                                {d.commitMessage && (
                                  <span className="text-xs text-muted-foreground truncate" title={d.commitMessage ?? undefined}>
                                    {d.commitMessage}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <p className="text-sm">{timeAgo(d.started_at ?? d.created_at)}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(d.started_at ?? d.created_at).toLocaleString()}
                            </p>
                          </TableCell>

                          <TableCell>
                            {d.started_at ? (
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Clock className={cn('h-3.5 w-3.5', isLive && 'text-blue-400')} />
                                {isLive
                                  ? <span className="text-blue-400">running…</span>
                                  : deployDuration(d.started_at, d.finished_at ?? undefined)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right pr-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/deployments/${d.uuid}`, { state: { appName, appUuid: uuid } });
                              }}
                            >
                              <ScrollText className="h-3.5 w-3.5" />
                              View Logs
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {/* Page number pills */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce<(number | '…')[]>((acc, p, i, arr) => {
                      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === '…' ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                      ) : (
                        <Button
                          key={p}
                          variant={p === currentPage ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 w-7 p-0 text-xs"
                          onClick={() => setCurrentPage(p as number)}
                        >
                          {p}
                        </Button>
                      )
                    )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
