'use client';

import { Github } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, Code2, GitBranch, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectHeaderProps {
  project: any;
  activeDeployment: any;
  deploymentStatus?: any;
  latestBuild?: any;
  isDeploying: boolean;
  onTriggerBuild: () => Promise<void>;
}

const getDeployStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: 'Pending',
    dns_creating: 'DNS Setup',
    dns_created: 'DNS Ready',
    ssl_issuing: 'SSL Issuing',
    ssl_issued: 'SSL Ready',
    nginx_configuring: 'Configuring',
    nginx_configured: 'Configured',
    app_starting: 'Starting App',
    health_checking: 'Health Check',
    active: 'Active',
    inactive: 'Inactive',
    failed: 'Failed',
    activating: 'Activating',
  };
  return labels[status] || status.replace(/_/g, ' ');
};

export function ProjectHeader({
  project,
  activeDeployment,
  deploymentStatus,
  latestBuild,
  isDeploying,
  onTriggerBuild,
}: ProjectHeaderProps) {
  const liveUrl = project.domain
    ? `https://${project.domain}`
    : project.port
      ? `http://localhost:${project.port}`
      : null;

  const isPipelineActive =
    deploymentStatus?.status && !['active', 'inactive', 'failed'].includes(deploymentStatus.status);

  const isBuilding =
    isDeploying || latestBuild?.status === 'building' || latestBuild?.status === 'pending';

  const isDeployFailed =
    deploymentStatus?.status === 'failed' ||
    (!activeDeployment && latestBuild?.status === 'failed');

  const isBusy = isDeploying || isBuilding || isPipelineActive;

  const renderDeploymentBadge = () => {
    if (isBuilding) {
      return (
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Loader2 className="h-3 w-3 animate-spin text-brand-500" />
          <span>Building{latestBuild?.id ? ` #${latestBuild.id.slice(0, 7)}` : '...'}</span>
        </Badge>
      );
    }

    if (isPipelineActive) {
      const stepLabel =
        deploymentStatus.status_message || getDeployStatusLabel(deploymentStatus.status);
      return (
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Loader2 className="h-3 w-3 animate-spin text-brand-500" />
          <span>Deploying: {stepLabel}</span>
        </Badge>
      );
    }

    if (activeDeployment) {
      return (
        <Badge variant="outline" className="gap-1.5 font-normal">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span>Production live</span>
        </Badge>
      );
    }

    if (isDeployFailed) {
      return (
        <Badge variant="destructive" className="gap-1.5 font-normal">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
          <span>Build Failed</span>
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="gap-1.5 font-normal text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        <span>Not deployed</span>
      </Badge>
    );
  };

  return (
    <header className="sticky top-[68px] z-20 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {project.name}
              </h1>
              {renderDeploymentBadge()}
              <Badge variant="outline" className="gap-1.5 font-normal capitalize">
                <Code2 className="h-3 w-3" /> {project.app_type}
              </Badge>
              {project.github_branch && (
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                  <GitBranch className="h-3.5 w-3.5" /> {project.github_branch}
                </span>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={project.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-2"
              >
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">Repository</span>
              </a>
            </Button>
            {activeDeployment && liveUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                  Visit <ArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() =>
                toast.promise(onTriggerBuild(), {
                  loading: 'Starting deployment...',
                  success: 'Deployment started',
                  error: 'Failed to start deployment',
                })
              }
              disabled={isBusy}
              className="gap-2"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="hidden sm:inline">Deploy</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
