import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Clock } from 'lucide-react';
import Layout from '@/components/Layout';
import LogViewer from '@/components/LogViewer';
import { getDeployment } from '@/api';
import type { Deployment } from '@/types';

function useElapsed(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function DeploymentView() {
  const { uuid } = useParams<{ uuid: string }>();
  const location = useLocation();
  const state   = location.state as { appName?: string; appUuid?: string } | null;
  const appName = state?.appName ?? 'Deployment';
  const appUuid = state?.appUuid;

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [done, setDone] = useState(false);
  const startedAt = deployment?.started_at ?? deployment?.created_at ?? null;
  const elapsed = useElapsed(done ? null : startedAt);

  useEffect(() => {
    if (!uuid || !appUuid) return;
    getDeployment(uuid, appUuid).then(setDeployment).catch(console.error);
  }, [uuid, appUuid]);

  if (!uuid || !appUuid) return null;

  return (
    <Layout
      fullHeight
      crumbs={[
        { label: 'Dashboard', href: '/' },
        { label: appName },
      ]}
      navRight={
        startedAt && !done ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            {elapsed}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col min-h-0 h-full max-w-7xl w-full mx-auto px-6 py-5">
        {/* deployment meta */}
        <div className="flex items-center gap-2 mb-4 min-w-0 shrink-0">
          <code className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded truncate max-w-[320px]">
            {uuid}
          </code>
          {startedAt && (
            <span className="text-xs text-muted-foreground shrink-0">
              · started {new Date(startedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <LogViewer deploymentUuid={uuid} appUuid={appUuid} onDone={() => setDone(true)} />
        </div>
      </div>
    </Layout>
  );
}
