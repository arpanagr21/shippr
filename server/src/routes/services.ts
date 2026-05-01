import { Router } from 'express';
import type { Response } from 'express';
import { coolify } from '../coolify/client';
import { canAccessService } from '../models/registry';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/services/:uuid/deploy
router.post('/:uuid/deploy', async (req: AuthRequest, res: Response) => {
  if (!await canAccessService(req.user!, req.params.uuid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    await coolify.deployService(req.params.uuid);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to trigger deployment' });
  }
});

export default router;
