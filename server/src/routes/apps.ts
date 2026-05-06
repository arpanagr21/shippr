import { Router } from 'express';
import type { Response } from 'express';
import { coolify } from '../coolify/client';
import { syncRegistry, maybeBackgroundSync, getLastSyncAt } from '../sync';
import {
  getAllowedEnvUuids,
  findApplications,
  findServices,
  canAccessApplication,
} from '../models/registry';
import { getCachedDeployments, setCachedDeployments } from '../models/deployments';
import type { AuthRequest } from '../middleware/auth';
import type { RegistryApp, RegistryService } from '../models/registry';
import type { NormalizedDeployment } from '../coolify/adapter';

const router = Router();

function toDTO(d: NormalizedDeployment) {
  return {
    uuid:          d.uuid,
    status:        d.status,
    commit:        d.commit        ?? null,
    commitMessage: d.commitMessage ?? null,
    created_at:    d.createdAt,
    started_at:    d.startedAt,
    finished_at:   d.finishedAt   ?? null,
  };
}

interface AppDTO {
  uuid:             string;
  name:             string;
  status:           string;
  resourceType:     'application';
  fqdn?:            string;
  environment?:     { name: string };
  latestDeployment: { uuid: string; status: string; updated_at: string } | null;
}

interface ServiceDTO {
  uuid:         string;
  name:         string;
  status:       string;
  resourceType: 'service';
  environment?: { name: string };
}

function toAppDTO(app: RegistryApp): AppDTO {
  return {
    uuid:         app.uuid,
    name:         app.name,
    status:       app.status,
    resourceType: 'application',
    fqdn:         app.fqdn         ?? undefined,
    environment:  app.environmentName ? { name: app.environmentName } : undefined,
    latestDeployment: app.latestDeploymentUuid
      ? {
          uuid:       app.latestDeploymentUuid,
          status:     app.latestDeploymentStatus ?? '',
          updated_at: app.latestDeploymentUpdatedAt ?? '',
        }
      : null,
  };
}

function toServiceDTO(svc: RegistryService): ServiceDTO {
  return {
    uuid:         svc.uuid,
    name:         svc.name,
    status:       svc.status,
    resourceType: 'service',
    environment:  svc.environmentName ? { name: svc.environmentName } : undefined,
  };
}

// GET /api/apps
router.get('/', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    if (req.query.refresh === 'true') await syncRegistry();

    const allowed = await getAllowedEnvUuids(user);
    if (allowed !== 'all' && allowed.size === 0) {
      maybeBackgroundSync();
      return res.json({ apps: [], services: [], cachedAt: getLastSyncAt() });
    }

    const [apps, services] = await Promise.all([
      findApplications(allowed),
      findServices(allowed),
    ]);

    maybeBackgroundSync();
    res.json({
      apps:     apps.map(toAppDTO),
      services: services.map(toServiceDTO),
      cachedAt: getLastSyncAt(),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch apps' });
  }
});

// GET /api/apps/:uuid/deployments
router.get('/:uuid/deployments', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (!await canAccessApplication(user, req.params.uuid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const bust = req.query.refresh === 'true';
  const skip = Math.max(0, parseInt(req.query.skip as string) || 0);
  const take = Math.min(50, Math.max(1, parseInt(req.query.take as string) || 20));

  // Load More (skip > 0): always hit Coolify directly, no cache
  if (skip > 0) {
    try {
      const { deployments, hasMore } = await coolify.getApplicationDeployments(req.params.uuid, skip, take);
      return res.json({ data: deployments.map(toDTO), hasMore });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[deployments] load-more failed for app ${req.params.uuid} skip=${skip}: ${reason}`);
      return res.status(502).json({ error: 'Failed to load more deployments', reason });
    }
  }

  // First page: use DB cache
  const stale = await getCachedDeployments(req.params.uuid);

  try {
    if (bust || !stale) {
      const { deployments, hasMore } = await coolify.getApplicationDeployments(req.params.uuid, 0, take);
      await setCachedDeployments(req.params.uuid, deployments);
      const fresh = await getCachedDeployments(req.params.uuid);
      return res.json({ data: fresh?.data ?? [], hasMore, cachedAt: fresh?.cachedAt ?? Date.now() });
    }
    return res.json({ data: stale.data, hasMore: stale.data.length >= take, cachedAt: stale.cachedAt });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[deployments] fetch failed for app ${req.params.uuid}: ${reason}`);
    if (stale) {
      return res.json({
        data:     stale.data,
        hasMore:  stale.data.length >= take,
        cachedAt: stale.cachedAt,
        warning:  `Showing cached data — live fetch failed: ${reason}`,
      });
    }
    return res.status(502).json({ error: 'Failed to fetch deployments', reason });
  }
});

// POST /api/apps/:uuid/deploy
router.post('/:uuid/deploy', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (!await canAccessApplication(user, req.params.uuid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const { deploymentUuid } = await coolify.deployApplication(req.params.uuid);
    res.json({ deploymentUuid });
  } catch {
    res.status(500).json({ error: 'Failed to trigger deployment' });
  }
});

export default router;
