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

const router = Router();

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

  const bust  = req.query.refresh === 'true';
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

  try {
    let cached = bust ? null : await getCachedDeployments(req.params.uuid);

    if (!cached) {
      const all = await coolify.getApplicationDeployments(req.params.uuid);
      await setCachedDeployments(req.params.uuid, all);
      cached = await getCachedDeployments(req.params.uuid) ?? { data: [], cachedAt: Date.now() };
    }

    const { data: deployments, cachedAt } = cached;
    const total = deployments.length;
    const start = (page - 1) * limit;

    res.json({
      data:       deployments.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      cachedAt,
    });
  } catch (err) {
    res.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 1, error: 'Failed to fetch deployments' });
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
