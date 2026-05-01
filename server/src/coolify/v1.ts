/**
 * Coolify API v1 adapter.
 *
 * All raw v1 API response shapes are private to this file.
 * The rest of the codebase only sees the normalized types from adapter.ts.
 */

import { config } from '../config';
import type {
  CoolifyAdapter,
  NormalizedProject,
  NormalizedApp,
  NormalizedService,
  NormalizedDeployment,
  NormalizedLogEntry,
} from './adapter';

// ── Raw v1 API response shapes ────────────────────────────────────────────────

interface V1LogEntry {
  output:     string;
  order?:     number;
  type?:      'stdout' | 'stderr';
  hidden?:    boolean;
  batch?:     number;
  command?:   string | null;
  timestamp?: string;
}

interface V1Deployment {
  deployment_uuid:  string;
  application_id?:  number | string;
  status:           string;
  commit?:          string;
  commit_message?:  string;
  logs?:            string; // JSON-encoded V1LogEntry[]
  created_at:       string;
  started_at?:      string | null;
  updated_at:       string;
  finished_at?:     string | null;
}

interface V1DeploymentsResponse {
  count:       number;
  deployments: V1Deployment[];
}

interface V1Environment {
  id:   number;
  uuid: string;
  name: string;
}

interface V1Project {
  id:           number;
  uuid:         string;
  name:         string;
  description?: string;
  environments?: V1Environment[];
}

interface V1Application {
  uuid:                string;
  name:                string;
  status:              string;
  fqdn?:               string;
  build_pack?:         string;
  docker_compose_raw?: string;
  docker_compose?:     string;
  environment_id?:     number;
  environment?:        { uuid: string; name: string };
  created_at:          string;
  updated_at:          string;
}

interface V1Service {
  uuid:                string;
  name:                string;
  status:              string;
  docker_compose_raw?: string;
  environment?:        { uuid: string; name: string };
  created_at:          string;
  updated_at:          string;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '');
}

function parseLogEntries(raw: string | undefined): NormalizedLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return (parsed as V1LogEntry[])
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e, i) => ({ output: stripAnsi(e.output), order: e.order ?? i, type: e.type }));
    }
    // Parsed but not an array — fall through to plain-text handling
  } catch {
    // Not JSON — fall through
  }
  // Plain text: split on newlines
  return raw
    .split('\n')
    .map((line, i) => ({ output: stripAnsi(line), order: i }));
}

function normalizeDeployment(d: V1Deployment, withLogs: boolean): NormalizedDeployment {
  return {
    uuid:          d.deployment_uuid,
    status:        d.status,
    commit:        d.commit,
    commitMessage: d.commit_message,
    logEntries:    withLogs ? parseLogEntries(d.logs) : [],
    createdAt:     d.created_at,
    startedAt:     d.started_at ?? d.created_at,
    updatedAt:     d.updated_at,
    finishedAt:    d.finished_at ?? null,
  };
}

// ── V1Adapter ─────────────────────────────────────────────────────────────────

export class V1Adapter implements CoolifyAdapter {
  private readonly base: string;

  constructor() {
    this.base = `${config.coolifyUrl}/api/${config.coolifyApiVersion}`;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...options,
        headers: {
          Authorization:  `Bearer ${config.coolifyToken}`,
          'Content-Type': 'application/json',
          Accept:         'application/json',
          ...options?.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Coolify API ${res.status} on ${path}: ${text}`);
      }
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async getProjects(): Promise<NormalizedProject[]> {
    const list = await this.request<V1Project[]>('/projects');
    // List endpoint omits environments — fetch each project individually to get them
    const detailed = await Promise.all(
      list.map((p) => this.request<V1Project>(`/projects/${p.uuid}`)),
    );
    return detailed.map((p) => ({
      uuid:         p.uuid,
      name:         p.name,
      description:  p.description,
      environments: (p.environments ?? []).map((e) => ({ id: e.id, uuid: e.uuid, name: e.name })),
    }));
  }

  async getApplications(): Promise<NormalizedApp[]> {
    const raw = await this.request<V1Application[]>('/applications');
    return raw.map((a) => ({
      uuid:             a.uuid,
      name:             a.name,
      status:           a.status,
      fqdn:             a.fqdn,
      buildPack:        a.build_pack,
      isDockerCompose:  a.build_pack === 'dockercompose' || a.docker_compose_raw != null || a.docker_compose != null,
      dockerComposeRaw: a.docker_compose_raw,
      dockerCompose:    a.docker_compose,
      environmentId:    a.environment_id,
      environmentUuid:  a.environment?.uuid,
      environmentName:  a.environment?.name,
      createdAt:        a.created_at,
      updatedAt:        a.updated_at,
    }));
  }

  async getServices(): Promise<NormalizedService[]> {
    const raw = await this.request<V1Service[]>('/services');
    return raw.map((s) => ({
      uuid:             s.uuid,
      name:             s.name,
      status:           s.status,
      dockerComposeRaw: s.docker_compose_raw,
      environmentUuid:  s.environment?.uuid,
      environmentName:  s.environment?.name,
      createdAt:        s.created_at,
      updatedAt:        s.updated_at,
    }));
  }

  async getApplicationDeployments(appUuid: string): Promise<NormalizedDeployment[]> {
    const BATCH = 10;
    const first = await this.request<V1DeploymentsResponse>(
      `/deployments/applications/${appUuid}?skip=0&take=${BATCH}`,
    );
    const all   = [...(first.deployments ?? [])];
    const total = first.count ?? all.length;

    let skip = all.length;
    while (skip < total) {
      const page = await this.request<V1DeploymentsResponse>(
        `/deployments/applications/${appUuid}?skip=${skip}&take=${BATCH}`,
      );
      const batch = page.deployments ?? [];
      if (batch.length === 0) break;
      all.push(...batch);
      skip += batch.length;
    }

    return all.map((d) => normalizeDeployment(d, false));
  }

  async getDeploymentWithLogs(appUuid: string, deploymentUuid: string): Promise<NormalizedDeployment> {
    // The app-specific endpoint returns real-time logs for in-progress deployments.
    // In-progress deployments are always in the most-recent page, so take=10 is enough.
    // For older deployments not on this page, fall back to the direct endpoint.
    const res = await this.request<V1DeploymentsResponse>(
      `/deployments/applications/${appUuid}?skip=0&take=10`,
    );
    const d = res.deployments?.find((dep) => dep.deployment_uuid === deploymentUuid);
    if (d) return normalizeDeployment(d, true);
    return this.getDeploymentByUuid(deploymentUuid);
  }

  async getDeploymentByUuid(deploymentUuid: string): Promise<NormalizedDeployment> {
    const d = await this.request<V1Deployment>(`/deployments/${deploymentUuid}`);
    return normalizeDeployment(d, true);
  }

  async deployApplication(appUuid: string): Promise<{ deploymentUuid: string }> {
    const res = await this.request<{ uuid: string; deployment_uuid: string }>(
      `/applications/${appUuid}/start`,
      { method: 'POST' },
    );
    return { deploymentUuid: res.deployment_uuid ?? res.uuid };
  }

  async deployService(serviceUuid: string): Promise<void> {
    await this.request(`/services/${serviceUuid}/start`, { method: 'POST' });
  }
}
