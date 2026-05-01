export interface Deployment {
  uuid:           string;
  status:         'queued' | 'in_progress' | 'finished' | 'failed' | 'cancelled' | string;
  commit?:        string | null;
  commitMessage?: string | null;
  created_at:     string;
  started_at:     string;
  finished_at:    string | null;
}

export interface Application {
  uuid:             string;
  name:             string;
  status:           string;
  fqdn?:            string;
  environment?:     { name: string };
  resourceType:     'application';
  latestDeployment: { uuid: string; status: string; updated_at: string } | null;
}

export interface Service {
  uuid:         string;
  name:         string;
  status:       string;
  environment?: { name: string };
  resourceType: 'service';
}

export type Resource = Application | Service;
