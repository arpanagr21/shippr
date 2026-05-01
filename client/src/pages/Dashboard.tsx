import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Activity, CirclePause, CircleAlert, Rocket, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorAlert from '@/components/ErrorAlert';
import { Separator } from '@/components/ui/separator';
import Layout from '@/components/Layout';
import AppCard from '@/components/AppCard';
import { getApps } from '@/api';
import type { Resource, Application } from '@/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 12;

interface StatProps {
  icon: React.ElementType;
  label: string;
  value: number;
  color?: string;
}

function Stat({ icon: Icon, label, value, color }: StatProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', color ?? 'bg-muted')}>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [cachedAt, setCachedAt]   = useState<number | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [search, setSearch]               = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage]     = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (bust = false) => {
    bust ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const data = await getApps(bust);
      setResources([...data.apps, ...data.services]);
      setCachedAt(data.cachedAt);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  function handleSearchChange(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setCurrentPage(1);
    }, 300);
  }

  const running   = resources.filter((r) => r.status.startsWith('running')).length;
  const stopped   = resources.filter((r) => r.status === 'stopped' || r.status.startsWith('exited')).length;
  const failed    = resources.filter((r) => r.resourceType === 'application' && (r as Application).latestDeployment?.status === 'failed').length;
  const deploying = resources.filter((r) => r.resourceType === 'application' && (r as Application).latestDeployment?.status === 'in_progress').length;

  // Auto-refresh every 5 s while any deployment is in progress
  useEffect(() => {
    if (deploying === 0) return;
    const id = setInterval(() => void load(false), 5000);
    return () => clearInterval(id);
  }, [deploying, load]);

  const filtered = resources.filter((r) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      (r.environment?.name ?? '').toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(currentPage, totalPages);
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Layout
      crumbs={[{ label: 'Dashboard' }]}
      navRight={
        <div className="flex items-center gap-3">
          {cachedAt && !loading && (
            <span className="text-xs text-muted-foreground">
              cached {new Date(cachedAt).toLocaleTimeString()}
            </span>
          )}
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
        </div>
      }
    >
      <div className="max-w-7xl mx-auto w-full px-6 py-8 space-y-8">

        {/* Deploying banner */}
        {!loading && deploying > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
            <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
            <p className="text-sm text-blue-400 font-medium">
              {deploying} deployment{deploying !== 1 ? 's' : ''} in progress — refreshing automatically
            </p>
          </div>
        )}

        {/* Stats */}
        {!loading && resources.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat icon={Activity}    label="Running"   value={running}           color="bg-emerald-500/10" />
            <Stat icon={Loader2}     label="Deploying" value={deploying}         color="bg-blue-500/10" />
            <Stat icon={CirclePause} label="Stopped"   value={stopped}           color="bg-slate-500/10" />
            <Stat icon={CircleAlert} label="Failed"    value={failed}            color="bg-red-500/10" />
          </div>
        )}

        <ErrorAlert error={error} />

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg border bg-card animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 rounded-xl border bg-card animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && resources.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted border">
              <Rocket className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">No Docker Compose apps found</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Make sure your Coolify instance has Docker Compose applications or services.
              </p>
            </div>
            <Separator className="max-w-[200px]" />
            <p className="text-xs text-muted-foreground">
              Check{' '}
              <code className="bg-muted px-1 py-0.5 rounded">COOLIFY_URL</code> and{' '}
              <code className="bg-muted px-1 py-0.5 rounded">COOLIFY_TOKEN</code> in your{' '}
              <code className="bg-muted px-1 py-0.5 rounded">.env</code>
            </p>
          </div>
        )}

        {/* App grid */}
        {!loading && resources.length > 0 && (
          <div className="space-y-4">
            {/* Search + count row */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search apps…"
                  className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                {filtered.length} resource{filtered.length !== 1 ? 's' : ''}
                {debouncedSearch && resources.length !== filtered.length && ` of ${resources.length}`}
              </p>
            </div>

            {/* No search results */}
            {filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No resources match &ldquo;{debouncedSearch}&rdquo;
              </div>
            )}

            {/* Cards */}
            {paged.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {paged.map((r) => (
                  <AppCard key={r.uuid} resource={r} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  Page {safePage} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, p, i, arr) => {
                      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === '…' ? (
                        <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                      ) : (
                        <Button
                          key={p}
                          variant={p === safePage ? 'default' : 'outline'}
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
                    disabled={safePage >= totalPages}
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
