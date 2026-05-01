import { Router } from 'express';
import type { Response } from 'express';
import { coolify } from '../coolify/client';
import { canAccessApplication } from '../models/registry';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

const TERMINAL = new Set(['finished', 'failed', 'cancelled']);

// GET /api/logs/:uuid?app_uuid=<uuid>&offset=<n>
router.get('/:uuid', async (req: AuthRequest, res: Response) => {
  const { uuid } = req.params;
  const appUuid  = req.query.app_uuid as string | undefined;
  const offset   = Math.max(0, parseInt(req.query.offset as string) || 0);
  const user     = req.user!;

  if (!appUuid) {
    return res.status(400).json({ error: 'app_uuid query parameter is required' });
  }

  if (!await canAccessApplication(user, appUuid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const deployment = await coolify.getDeploymentWithLogs(appUuid, uuid);

    const entries = deployment.logEntries.map((e) => ({ text: e.output, type: e.type }));

    res.json({
      lines:  entries.slice(offset),
      status: deployment.status,
      done:   TERMINAL.has(deployment.status),
      total:  entries.length,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

export default router;
