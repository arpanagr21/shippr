/**
 * CoolifyAdapter — version-agnostic interface and normalized types.
 *
 * The rest of the codebase depends only on this interface and these types.
 * To support a new Coolify API version, create a new adapter file (e.g. v2.ts)
 * that implements CoolifyAdapter and register it in client.ts. No other files
 * should need to change.
 */

export interface NormalizedProject {
  uuid:         string;
  name:         string;
  description?: string;
  environments: Array<{ id?: number; uuid: string; name: string }>;
}

export interface NormalizedApp {
  uuid:             string;
  name:             string;
  status:           string;
  fqdn?:            string;
  buildPack?:       string;
  isDockerCompose:  boolean;
  dockerComposeRaw?: string;
  dockerCompose?:   string;
  environmentId?:   number;
  environmentUuid?: string;
  environmentName?: string;
  createdAt:        string;
  updatedAt:        string;
}

export interface NormalizedService {
  uuid:             string;
  name:             string;
  status:           string;
  dockerComposeRaw?: string;
  environmentUuid?: string;
  environmentName?: string;
  createdAt:        string;
  updatedAt:        string;
}

export interface NormalizedLogEntry {
  output: string;  // ANSI escape codes already stripped
  order:  number;
  type?:  'stdout' | 'stderr';
}

export interface NormalizedDeployment {
  uuid:           string;
  status:         string;
  commit?:        string;
  commitMessage?: string;
  /** Sorted by order, ANSI stripped. Empty when fetched from list endpoints. */
  logEntries:     NormalizedLogEntry[];
  createdAt:      string;
  startedAt:      string;  // falls back to createdAt when not provided by the API
  updatedAt:      string;
  finishedAt?:    string | null;
}

export interface CoolifyAdapter {
  getProjects():     Promise<NormalizedProject[]>;
  getApplications(): Promise<NormalizedApp[]>;
  getServices():     Promise<NormalizedService[]>;

  /** Full deployment history for one app, newest first. logEntries is always []. */
  getApplicationDeployments(appUuid: string): Promise<NormalizedDeployment[]>;

  /** Single deployment with full logs, looked up within the app's deployment list. */
  getDeploymentWithLogs(appUuid: string, deploymentUuid: string): Promise<NormalizedDeployment>;

  /** Single deployment with full logs, looked up directly by deployment UUID. */
  getDeploymentByUuid(deploymentUuid: string): Promise<NormalizedDeployment>;

  deployApplication(appUuid: string): Promise<{ deploymentUuid: string }>;
  deployService(serviceUuid: string): Promise<void>;
}
