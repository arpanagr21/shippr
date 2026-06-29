import { Router } from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { docker, demuxLogs } from '../docker';
import { getAllowedEnvUuids, findApplications, findServices } from '../models/registry';

const router = Router();

interface AccessibleIds {
  appUuids:     Set<string>;
  serviceUuids: Set<string>;
}

// Returns null for super_admin (sees all), or the set of accessible UUIDs
async function getAccessibleIds(user: AuthRequest['user'] & {}): Promise<AccessibleIds | null> {
  if (user.role === 'super_admin') return null;
  const allowedEnvs = await getAllowedEnvUuids(user);
  const [apps, services] = await Promise.all([
    findApplications(allowedEnvs),
    findServices(allowedEnvs),
  ]);
  return {
    appUuids:     new Set(apps.map((a) => a.uuid)),
    serviceUuids: new Set(services.map((s) => s.uuid)),
  };
}

function canSee(labels: Record<string, string>, ids: AccessibleIds | null): boolean {
  if (ids === null) return true;
  const appId = labels['coolify.applicationId'];
  const svcId = labels['coolify.serviceId'];
  if (appId && ids.appUuids.has(appId)) return true;
  if (svcId && ids.serviceUuids.has(svcId)) return true;
  return false;
}

// GET /api/containers
router.get('/', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const [rawList, ids] = await Promise.all([
      docker.listContainers({ all: true }),
      getAccessibleIds(user),
    ]);

    const containers = rawList
      .filter((c) => canSee(c.Labels ?? {}, ids))
      .map((c) => ({
        id:             c.Id.slice(0, 12),
        name:           (c.Names[0] ?? '').replace(/^\//, ''),
        image:          c.Image,
        status:         c.Status,
        state:          c.State,
        created:        c.Created,
        composeProject: c.Labels?.['com.docker.compose.project'] ?? null,
        composeService: c.Labels?.['com.docker.compose.service'] ?? null,
        coolifyAppId:   c.Labels?.['coolify.applicationId']     ?? null,
        coolifyType:    c.Labels?.['coolify.type']              ?? null,
      }))
      .sort((a, b) => {
        if (a.state === 'running' && b.state !== 'running') return -1;
        if (a.state !== 'running' && b.state === 'running') return 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ containers });
  } catch (err) {
    console.error('[containers] list error:', err);
    res.status(500).json({ error: 'Failed to list containers' });
  }
});

// GET /api/containers/:id/logs?since=0
router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
  const user  = req.user!;
  const { id } = req.params;
  const since = parseFloat(req.query.since as string) || 0;

  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    const labels = info.Config.Labels ?? {};

    const ids = await getAccessibleIds(user);
    if (!canSee(labels, ids)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const logOpts = {
      stdout:     true,
      stderr:     true,
      timestamps: true,
      ...(since > 0 ? { since: since + 0.001 } : { tail: 300 }),
    };

    const buf = await container.logs(logOpts) as unknown as Buffer;
    const lines = demuxLogs(buf);

    const nextSince = lines.length > 0
      ? Math.max(...lines.map((l) => l.ts))
      : since;

    res.json({
      lines:     lines.map(({ text, type }) => ({ text, type })),
      running:   info.State.Running,
      nextSince,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No such container')) return res.status(404).json({ error: 'Container not found' });
    console.error('[containers] logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

export default router;
