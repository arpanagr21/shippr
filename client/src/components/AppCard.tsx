import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, ScrollText, Box, Layers, ExternalLink, Clock, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import StatusBadge from './StatusBadge';
import ErrorAlert from './ErrorAlert';
import { triggerAppDeploy, triggerServiceDeploy } from '@/api';
import type { Resource } from '@/types';
import { cn } from '@/lib/utils';


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DEPLOY_STATUS_RING: Record<string, string> = {
  in_progress: 'ring-1 ring-blue-500/40',
  failed:      'ring-1 ring-red-500/30',
};

export default function AppCard({ resource }: { resource: Resource }) {
  const navigate = useNavigate();
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isApp = resource.resourceType === 'application';
  const latestDeployment = isApp ? resource.latestDeployment : null;
  const ringClass = latestDeployment ? (DEPLOY_STATUS_RING[latestDeployment.status] ?? '') : '';

  function handleCardClick() {
    if (!isApp) return;
    navigate(`/apps/${resource.uuid}`, { state: { appName: resource.name, appUuid: resource.uuid } });
  }

  async function handleDeploy(e: React.MouseEvent) {
    e.stopPropagation();
    if (deploying) return;
    setDeploying(true);
    setError(null);
    try {
      if (isApp) {
        const { deploymentUuid } = await triggerAppDeploy(resource.uuid);
        navigate(`/deployments/${deploymentUuid}`, { state: { appName: resource.name, appUuid: resource.uuid } });
      } else {
        await triggerServiceDeploy(resource.uuid);
        setDeploying(false);
      }
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
      setDeploying(false);
    }
  }

  function handleViewLogs(e: React.MouseEvent) {
    e.stopPropagation();
    if (latestDeployment) {
      navigate(`/deployments/${latestDeployment.uuid}`, { state: { appName: resource.name, appUuid: resource.uuid } });
    }
  }

  return (
    <Card
      onClick={isApp ? handleCardClick : undefined}
      className={cn(
        'flex flex-col transition-all hover:shadow-md hover:border-border/80',
        ringClass,
        isApp && 'cursor-pointer group',
      )}
    >
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {resource.resourceType === 'service'
              ? <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
              : <Box className="h-4 w-4 text-muted-foreground shrink-0" />}
            <CardTitle className="text-base truncate">{resource.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={resource.status || 'unknown'} />
            {isApp && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {resource.environment && (
            <CardDescription className="text-xs">{resource.environment.name}</CardDescription>
          )}
          {resource.resourceType === 'application' && resource.fqdn && (
            <a
              href={resource.fqdn}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="truncate max-w-[140px]">{resource.fqdn.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
        </div>
      </CardHeader>

      <CardContent className="pb-3 flex-1 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-indigo-400 border-indigo-500/30 bg-indigo-500/10 text-xs">
            docker-compose
          </Badge>
          {resource.resourceType === 'service' && (
            <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-500/10 text-xs">
              service
            </Badge>
          )}
        </div>

        {latestDeployment ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Last deploy</span>
              <StatusBadge status={latestDeployment.status} />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-xs text-muted-foreground cursor-default">
                  <Clock className="h-3 w-3" />
                  {timeAgo(latestDeployment.updated_at)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {new Date(latestDeployment.updated_at).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : isApp ? (
          <p className="text-xs text-muted-foreground">No deployments yet</p>
        ) : null}

        <ErrorAlert error={error} compact />
      </CardContent>

      <Separator />

      <CardFooter className="gap-2 pt-3 pb-3">
        {isApp && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (latestDeployment) {
                handleViewLogs(e);
              } else {
                navigate(`/apps/${resource.uuid}`, { state: { appName: resource.name, appUuid: resource.uuid } });
              }
            }}
          >
            <ScrollText className="h-3.5 w-3.5" />
            {latestDeployment ? 'View Logs' : 'Deployments'}
          </Button>
        )}
        <Button
          size="sm"
          className="flex-1 h-8 gap-1.5 text-xs"
          disabled={deploying}
          onClick={(e) => void handleDeploy(e)}
        >
          <Rocket className="h-3.5 w-3.5" />
          {deploying ? 'Deploying…' : 'Deploy Now'}
        </Button>
      </CardFooter>
    </Card>
  );
}
