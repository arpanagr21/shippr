import { Router } from 'express';
import type { Response } from 'express';
import { syncRegistry, maybeBackgroundSync } from '../sync';
import { findProjectsForUser } from '../models/registry';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/projects — super_admin sees all, regular users see only their assigned projects.
router.get('/', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    if (req.query.refresh === 'true') await syncRegistry();
    const projects = await findProjectsForUser(user);
    maybeBackgroundSync();
    res.json(projects);
  } catch {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

export default router;
