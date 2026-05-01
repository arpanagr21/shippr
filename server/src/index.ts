import express from 'express';
import cors from 'cors';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db';
import { config } from './config';
import { initCache } from './cache';
import { requireAuth } from './middleware/auth';
import { runSeed }    from './db/seed';
import { syncRegistry } from './sync';
import appsRouter        from './routes/apps';
import servicesRouter    from './routes/services';
import deploymentsRouter from './routes/deployments';
import logsRouter        from './routes/logs';
import authRouter        from './routes/auth';
import adminRouter       from './routes/admin';
import projectsRouter    from './routes/projects';

initCache('memory');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

// Simple in-memory sliding-window rate limiter
function makeRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return (_req: Request, res: Response, next: NextFunction) => {
    const ip  = _req.ip ?? 'unknown';
    const now = Date.now();
    const win = now - windowMs;
    const ts  = (hits.get(ip) ?? []).filter((t) => t > win);
    if (ts.length >= max) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    ts.push(now);
    hits.set(ip, ts);
    next();
  };
}

// 300 req / 15 min per IP on all API routes
app.use('/api', makeRateLimiter(15 * 60 * 1000, 300));
// Tighter: 200 req / 1 min on log-polling (called every ~800 ms while a deployment is open)
app.use('/api/logs', makeRateLimiter(60 * 1000, 200));

// Public config — Firebase web SDK settings served to the client at runtime
app.get('/api/config', (_req, res) => {
  res.json({
    firebaseApiKey:            config.firebaseApiKey,
    firebaseAuthDomain:        config.firebaseAuthDomain,
    firebaseProjectId:         config.firebaseProjectId,
    firebaseStorageBucket:     config.firebaseStorageBucket,
    firebaseMessagingSenderId: config.firebaseMessagingSenderId,
    firebaseAppId:             config.firebaseAppId,
    googleHd:                  config.googleHd,
  });
});

// Health check — no auth required
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'ok', ts: Date.now() });
  } catch {
    res.status(503).json({ ok: false, db: 'error' });
  }
});

// All /api routes require a valid Firebase token
app.use('/api', requireAuth);

app.use('/api/auth',        authRouter);
app.use('/api/admin',       adminRouter);
app.use('/api/projects',    projectsRouter);
app.use('/api/apps',        appsRouter);
app.use('/api/services',    servicesRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/logs',        logsRouter);

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

async function start() {
  // For SQLite: enable WAL mode and foreign key enforcement
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl || dbUrl.startsWith('file:')) {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
  }

  app.listen(config.port, () => {
    console.log(`Shippr running on http://localhost:${config.port}`);
    void runSeed();
    void syncRegistry().catch(console.error);
  });
}

void start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
