import { prisma } from '../db';
import type { NormalizedDeployment } from '../coolify/adapter';

export interface CachedDeployment {
  uuid:           string;
  status:         string;
  commit?:        string | null;
  commitMessage?: string | null;
  created_at:     string;
  started_at:     string;
  finished_at:    string | null;
}

export async function getCachedDeployments(
  appUuid: string,
): Promise<{ data: CachedDeployment[]; cachedAt: number } | null> {
  const rows = await prisma.deploymentCache.findMany({
    where:   { appUuid },
    orderBy: { createdAt: 'desc' },
  });

  if (rows.length === 0) return null;

  const cachedAt = rows.reduce(
    (max, r) => Math.max(max, new Date(r.cachedAt).getTime()),
    0,
  );

  return {
    data: rows.map((r) => ({
      uuid:          r.deploymentUuid,
      status:        r.status,
      commit:        r.commit        ?? null,
      commitMessage: r.commitMessage ?? null,
      created_at:    r.createdAt,
      started_at:    r.startedAt,
      finished_at:   r.finishedAt   ?? null,
    })),
    cachedAt,
  };
}

export async function setCachedDeployments(
  appUuid:     string,
  deployments: NormalizedDeployment[],
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.deploymentCache.deleteMany({ where: { appUuid } });
  if (deployments.length > 0) {
    await prisma.deploymentCache.createMany({
      data: deployments.map((d) => ({
        appUuid,
        deploymentUuid: d.uuid,
        status:         d.status,
        commit:         d.commit         ?? null,
        commitMessage:  d.commitMessage  ?? null,
        createdAt:      d.createdAt,
        startedAt:      d.startedAt,
        updatedAt:      d.updatedAt,
        finishedAt:     d.finishedAt     ?? null,
        cachedAt:       now,
      })),
    });
  }
}
