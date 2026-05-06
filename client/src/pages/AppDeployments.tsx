import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, ScrollText, Rocket, Clock, CheckCircle2, XCircle, Box, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorAlert from '@/components/ErrorAlert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Layout from '@/components/Layout';
import StatusBadge from '@/components/StatusBadge';
import { getAppDeployments, triggerAppDeploy } from '@/api';
import type { Deployment } from '@/types';
import { cn } from '@/lib/utils';

const TAKE = 20;

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

function StatCard({ icon: Icon, iconClass, value, label }: {
  icon: React.ElementType; iconClass?: string; value: number; label: string;
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
  const { uuid }   = useParams<{ uuid: string }>();
  const location   = useLocation();
  const navigate   = useNavigate();
  const appName    = (location.state as { appName?: string } | null)?.appName ?? uuid ?? 'App';

  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [hasMore, setHasMore]         = useState(false);
  const [skip, setSkip]               = useState(0);
  const [cachedAt, setCachedAt]       = useState<number | undefined>(undefined);
  const [warning, setWarning]         = useState<string | null>(null);

  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploying, setDeploying]     = useState(false);
  const [bgChecking, setBgChecking]   = useState(false);

  const liveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePolling     = useRef(false);
  const bgCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgCheckInFlight = useRef(false);
  const bgCheckDoneRef  = useRef(false);

  const load = useCallback(async (bust = false) => {
    if (!uuid) return;
    bust ? setRefreshing(true) : setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await getAppDeployments(uuid, 0, TAKE, bust);
      setDeployments(res.data);
      setHasMore(res.hasMore);
      setSkip(TAKE);
      if (res.cachedAt) setCachedAt(res.cachedAt);
      if (res.warning)  setWarning(res.warning);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uuid]);

  const loadMore = useCallback(async () => {
    if (!uuid || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await getAppDeployments(uuid, skip, TAKE, true);
      setDeployments((prev) => [...prev, ...res.data]);
      setHasMore(res.hasMore);
      setSkip((s) => s + TAKE);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoadingMore(false);
    }
  }, [uuid, skip, hasMore, loadingMore]);

  useEffect(() => { bgCheckDoneRef.current = false; }, [uuid]);
  useEffect(() => { void load(false); }, [load]);

  const hasLive = deployments.some((d) => d.status === 'in_progress' || d.status === 'queued');

  // 1s live-poll while any deployment is in_progress/queued
  useEffect(() => {
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    if (!hasLive) return;
    liveTimerRef.current = setTimeout(() => {
      if (livePolling.current) return;
      livePolling.current = true;
      void load(true).finally(() => { livePolling.current = false; });
    }, 1000);
    return () => { if (liveTimerRef.current) clearTimeout(liveTimerRef.current); };
  }, [deployments, load, hasLive]);

  // Background bust: 500ms after first cache load, then every 60s
  useEffect(() => {
    if (bgCheckTimerRef.current) clearTimeout(bgCheckTimerRef.current);
    if (hasLive || loading || deployments.length === 0) return;
    const delay = bgCheckDoneRef.current ? 60_000 : 500;
    bgCheckDoneRef.current = true;
    bgCheckTimerRef.current = setTimeout(async () => {
      if (bgCheckInFlight.current) return;
      bgCheckInFlight.current = true;
      setBgChecking(true);
      try {
        const res = await getAppDeployments(uuid!, 0, TAKE, true);
        setDeployments(res.data);
        setHasMore(res.hasMore);
        setSkip(TAKE);
        if (res.cachedAt) setCachedAt(res.cachedAt);
        if (res.warning)  setWarning(res.warning);
      } catch { /* silent */ }
      finally {
        bgCheckInFlight.current = false;
        setBgChecking(false);
      }
    }, delay);
    return () => { if (bgCheckTimerRef.current) clearTimeout(bgCheckTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployments, loading, hasLive]);

  async function handleDeploy() {
    if (!uuid || deploying) return;
    setDeploying(true);
    setDeployError(null);
    try {
      await triggerAppDeploy(uuid);
      await load(true);
    } catch (err) {
      setDeployError(String(err).replace('Error: ', ''));
    } finally {
      setDeploying(false);
    }
  }

  if (!uuid) return null;

  const succeeded  = deployments.filter((d) => d.status === 'finished').length;
  const failed     = deployments.filter((d) => d.status === 'failed').length;
  const inProgress = deployments.filter((d) => d.status === 'in_progress' || d.status === 'queued').length;

  return (
    <Layout
      crumbs={[{ label: 'Dashboard', href: '/' }, { label: appName }]}
      navRight={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
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
            {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
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
        {!loading && deployments.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Rocket}       value={deployments.length} label="Loaded"      />
            <StatCard icon={CheckCircle2} iconClass="text-emerald-400" value={succeeded}  label="Succeeded"   />
            <StatCard icon={XCircle}      iconClass="text-red-400"     value={failed}     label="Failed"      />
            <StatCard icon={Loader2}      iconClass="text-blue-400"    value={inProgress} label="In Progress" />
          </div>
        )}

        <ErrorAlert error={error ?? deployError} />

        {warning && !error && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-600 dark:text-yellow-400 break-words">{warning}</p>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && deployments.length === 0 && !error && (
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

        {/* Table */}
        {!loading && deployments.length > 0 && (
          <div className="space-y-4">
            {/* Cache / bg info row */}
            <div className="flex items-center justify-end gap-3">
              {bgChecking && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking live…
                </span>
              )}
              {cachedAt && !bgChecking && (
                <span className="text-xs text-muted-foreground">
                  cached {new Date(cachedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

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
                  {deployments.map((d) => {
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
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="gap-2"
                >
                  {loadingMore
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</>
                    : 'Load More'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
