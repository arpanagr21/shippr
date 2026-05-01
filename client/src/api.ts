import type { Application, Service, Deployment } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';

let authToken: string | null = null;
export function setAuthToken(t: string | null) { authToken = t; }

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(b.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface AppsResponse {
  apps:     Application[];
  services: Service[];
  cachedAt: number;
}
export const getApps = (refresh = false) =>
  get<AppsResponse>(`/api/apps${refresh ? '?refresh=true' : ''}`);

export interface DeploymentsPage {
  data:       Deployment[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
  cachedAt?:  number;
}
export const getAppDeployments = (uuid: string, page = 1, limit = 10, refresh = false) =>
  get<DeploymentsPage>(
    `/api/apps/${uuid}/deployments?page=${page}&limit=${limit}${refresh ? '&refresh=true' : ''}`,
  );

export const getDeployment = (uuid: string, appUuid: string) =>
  get<Deployment>(`/api/deployments/${uuid}?app_uuid=${encodeURIComponent(appUuid)}`);
export const triggerAppDeploy     = (uuid: string) => post<{ deploymentUuid: string }>(`/api/apps/${uuid}/deploy`);
export const triggerServiceDeploy = (uuid: string) => post<void>(`/api/services/${uuid}/deploy`);

// --- Admin ---

export interface AdminUser {
  id:        number;
  email:     string;
  name:      string | null;
  photo_url: string | null;
  role:      'user' | 'super_admin';
  projects:  string[];
}

export const getAdminUsers = () => get<AdminUser[]>('/api/admin/users');

export const setUserProjects = (userId: number, projects: string[]) =>
  put<{ ok: boolean }>(`/api/admin/users/${userId}/projects`, { projects });

export const setUserRole = (userId: number, role: 'user' | 'super_admin') =>
  put<{ ok: boolean }>(`/api/admin/users/${userId}/role`, { role });

export interface CoolifyProject {
  id:   number;
  uuid: string;
  name: string;
  description?: string;
  environments?: { id: number; uuid: string; name: string }[];
}
export const getCoolifyProjects = () => get<CoolifyProject[]>('/api/projects');

// --- Log polling ---

export interface LogLine {
  text: string;
  type?: 'stdout' | 'stderr';
}

export interface LogPollResponse {
  lines:  LogLine[];
  status: string;
  done:   boolean;
  total:  number;
}

export function pollLogs(
  deploymentUuid: string,
  appUuid:        string,
  offset:         number,
): Promise<LogPollResponse> {
  const params = new URLSearchParams({ offset: String(offset), app_uuid: appUuid });
  return get<LogPollResponse>(`/api/logs/${deploymentUuid}?${params.toString()}`);
}
