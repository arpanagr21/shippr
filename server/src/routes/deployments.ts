import { Router } from 'express';
import type { Response } from 'express';
import { coolify } from '../coolify/client';
import { canAccessApplication } from '../models/registry';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/:uuid', async (req: AuthRequest, res: Response) => {
  const user    = req.user!;
  const appUuid = req.query.app_uuid as string | undefined;

  if (!appUuid) {
    return res.status(400).json({ error: 'app_uuid query parameter is required' });
  }

  if (!await canAccessApplication(user, appUuid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const d = await coolify.getDeploymentByUuid(req.params.uuid);
    res.json({
      uuid:        d.uuid,
      status:      d.status,
      created_at:  d.createdAt,
      started_at:  d.startedAt,
      finished_at: d.finishedAt ?? null,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch deployment' });
  }
});

export default router;
