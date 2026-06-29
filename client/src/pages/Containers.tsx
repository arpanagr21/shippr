import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, ChevronDown, ChevronRight, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorAlert from '@/components/ErrorAlert';
import Layout from '@/components/Layout';
import { getContainers } from '@/api';
import type { DockerContainer } from '@/types';
import { cn } from '@/lib/utils';

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSeconds);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StateIndicator({ state }: { state: string }) {
  const running = state === 'running';
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn(
        'h-2 w-2 rounded-full shrink-0',
        running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500',
      )} />
      <span className={cn('text-xs', running ? 'text-emerald-400' : 'text-slate-500')}>
        {state}
      </span>
    </span>
  );
}

interface Group {
  name:       string;
  containers: DockerContainer[];
}

function groupContainers(containers: DockerContainer[]): Group[] {
  const map = new Map<string, DockerContainer[]>();

  for (const c of containers) {
    const key = c.composeProject ?? '__standalone__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }

  const groups: Group[] = [];
  // Named groups first (sorted), standalone last
  const keys = [...map.keys()].sort((a, b) => {
    if (a === '__standalone__') return 1;
    if (b === '__standalone__') return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    groups.push({
      name:       key === '__standalone__' ? 'Standalone' : key,
      containers: map.get(key)!,
    });
  }

  return groups;
}

function ContainerRow({ container, onClick }: { container: DockerContainer; onClick: () => void }) {
  const imageName = container.image.split(':')[0].split('/').pop() ?? container.image;
  const imageTag  = container.image.includes(':') ? container.image.split(':').pop() : 'latest';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-accent/40 transition-colors border-b border-border/40 last:border-b-0 group"
    >
      <StateIndicator state={container.state} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-foreground">
          {container.composeService ?? container.name}
        </p>
        {container.composeService && container.name !== container.composeService && (
          <p className="text-[11px] text-muted-foreground/60 truncate">{container.name}</p>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted-foreground/60">{imageName}</span>
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">
          {imageTag}
        </span>
      </div>

      <span className="text-xs text-muted-foreground/50 shrink-0 hidden md:block">
        {relativeTime(container.created)}
      </span>

      <span className="text-xs text-muted-foreground/40 shrink-0">{container.status}</span>
    </button>
  );
}

function GroupSection({ group, onSelect }: { group: Group; onSelect: (c: DockerContainer) => void }) {
  const [open, setOpen] = useState(true);
  const running = group.containers.filter((c) => c.state === 'running').length;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/30 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
        <Box className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        <span className="font-medium text-sm truncate">{group.name}</span>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          {running}/{group.containers.length} running
        </span>
      </button>

      {open && (
        <div className="divide-y divide-border/30">
          {group.containers.map((c) => (
            <ContainerRow key={c.id} container={c} onClick={() => onSelect(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Containers() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groups, setGroups]       = useState<Group[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState(searchParams.get('q') ?? '');

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { containers } = await getContainers();
      setGroups(groupContainers(containers));
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(() => void load(true), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const filteredGroups = search.trim()
    ? groups
        .map((g) => ({
          ...g,
          containers: g.containers.filter(
            (c) =>
              c.name.toLowerCase().includes(search.toLowerCase()) ||
              (c.composeService ?? '').toLowerCase().includes(search.toLowerCase()) ||
              c.image.toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((g) => g.containers.length > 0)
    : groups;

  const totalContainers = groups.reduce((n, g) => n + g.containers.length, 0);
  const runningCount    = groups.reduce(
    (n, g) => n + g.containers.filter((c) => c.state === 'running').length,
    0,
  );

  return (
    <Layout crumbs={[{ label: 'Containers' }]}>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Containers</h1>
            {!loading && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {runningCount} running · {totalContainers} total
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter containers…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          />
        </div>

        {error && <ErrorAlert error={error} />}

        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 rounded-lg border border-border bg-card animate-pulse" />
            ))}
          </div>
        )}

        {!loading && filteredGroups.length === 0 && !error && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {search ? 'No containers match your search.' : 'No containers found.'}
          </div>
        )}

        {!loading && (
          <div className="space-y-3">
            {filteredGroups.map((group) => (
              <GroupSection
                key={group.name}
                group={group}
                onSelect={(c) => navigate(`/containers/${c.id}`, { state: { name: c.composeService ?? c.name } })}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
