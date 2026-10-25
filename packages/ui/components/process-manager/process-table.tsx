'use client';

import { useState } from 'react';
import { PM0Process, pm0Api } from '@/lib/pm0-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Play,
  Square,
  RotateCw,
  RefreshCcw,
  Trash2,
  MoreVertical,
  ScrollText,
  Cpu,
  MemoryStick,
  Clock,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ProcessLogViewer } from './process-log-viewer';

// ── helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatUptime(uptimeMs: number): string {
  if (!uptimeMs) return '—';
  const diff = Date.now() - uptimeMs;
  if (diff < 0) return '—';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function formatExecMode(mode: string): string {
  if (!mode) return 'Fork';
  const label = mode.replace(/_mode$/, '').replace(/-/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type StatusKey = 'online' | 'stopped' | 'errored' | 'launching' | 'stopping' | 'waiting restart';

const statusConfig: Record<
  StatusKey,
  { color: string; bg: string; dot: string; rail: string; label: string }
> = {
  online: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    dot: 'bg-emerald-400',
    rail: 'bg-emerald-400/70',
    label: 'Online',
  },
  stopped: {
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10 border-zinc-500/20',
    dot: 'bg-zinc-400',
    rail: 'bg-zinc-500/50',
    label: 'Stopped',
  },
  errored: {
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    dot: 'bg-red-400',
    rail: 'bg-red-400/80',
    label: 'Errored',
  },
  launching: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-400',
    rail: 'bg-amber-400/80',
    label: 'Launching',
  },
  stopping: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    dot: 'bg-orange-400',
    rail: 'bg-orange-400/80',
    label: 'Stopping',
  },
  'waiting restart': {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-400 animate-pulse',
    rail: 'bg-amber-400/80',
    label: 'Restarting',
  },
};

function getStatusConfig(status: string) {
  return (
    statusConfig[status as StatusKey] ?? {
      color: 'text-zinc-400',
      bg: 'bg-zinc-500/10 border-zinc-500/20',
      dot: 'bg-zinc-400',
      rail: 'bg-zinc-500/50',
      label: status,
    }
  );
}

interface MetricItem {
  icon: typeof Cpu;
  label: string;
  value: string;
  muted?: boolean;
  danger?: boolean;
}

function MetricCell({ icon: Icon, label, value, muted, danger }: MetricItem) {
  return (
    <div className="flex flex-col gap-1 bg-surface-muted/30 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-sm font-medium tabular-nums',
          muted ? 'text-muted-foreground' : 'text-foreground',
          danger && 'text-red-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── component ────────────────────────────────────────────────────────

interface ProcessTableProps {
  processes: PM0Process[];
  onRefresh: () => void;
  compact?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (pmId: number) => void;
}

export function ProcessTable({
  processes,
  onRefresh,
  compact = false,
  selectedIds,
  onToggleSelect,
}: ProcessTableProps) {
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PM0Process | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const runAction = async (
    action: 'stop' | 'restart' | 'reload' | 'delete',
    process: PM0Process,
  ) => {
    const key = `${action}-${process.pm_id}`;
    setActionLoading(key);
    try {
      switch (action) {
        case 'stop':
          await pm0Api.stopProcess(String(process.pm_id));
          toast.success(`Stopped ${process.name}`);
          break;
        case 'restart':
          await pm0Api.restartProcess(String(process.pm_id));
          toast.success(`Restarted ${process.name}`);
          break;
        case 'reload':
          await pm0Api.reloadProcess(String(process.pm_id));
          toast.success(`Reloaded ${process.name}`);
          break;
        case 'delete':
          await pm0Api.deleteProcess(String(process.pm_id));
          toast.success(`Deleted ${process.name}`);
          break;
      }
      onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to ${action} ${process.name}: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (processes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted/20 px-6 py-16 text-center sm:py-20">
        <div className="mb-4 grid size-14 place-items-center rounded-full border border-border bg-surface-muted">
          <Terminal className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight">No processes to show</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Nothing matched your filters, or the PM0 daemon has no supervised processes. Start one
          with{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            pm0 start app.js
          </code>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {processes.map((proc) => {
          const sc = getStatusConfig(proc.status);
          const isOnline = proc.status === 'online';
          const isLoading = (a: string) => actionLoading === `${a}-${proc.pm_id}`;
          const logsOpen = expandedLogs === String(proc.pm_id);

          const scriptName = proc.script?.split('/').pop() || proc.script || '—';
          const interpreter =
            proc.interpreter && proc.interpreter !== 'none' ? `${proc.interpreter} ` : '';
          const args = proc.args?.length ? ` ${proc.args.join(' ')}` : '';
          const command = `${interpreter}${scriptName}${args}`;
          const commandTitle = `${proc.interpreter} ${proc.script}${args}`.trim();

          const restartDanger = proc.max_restarts > 0 && proc.restart_time >= proc.max_restarts;
          const restartValue =
            proc.max_restarts > 0
              ? `${proc.restart_time}/${proc.max_restarts}`
              : String(proc.restart_time);

          const metrics: MetricItem[] = [
            {
              icon: Cpu,
              label: 'CPU',
              value: isOnline ? `${proc.monit.cpu.toFixed(1)}%` : '—',
              muted: !isOnline,
            },
            {
              icon: MemoryStick,
              label: 'Memory',
              value: isOnline ? formatBytes(proc.monit.memory) : '—',
              muted: !isOnline,
            },
            {
              icon: Clock,
              label: 'Uptime',
              value: isOnline ? formatUptime(proc.pm_uptime) : '—',
              muted: !isOnline,
            },
            {
              icon: RotateCw,
              label: 'Restarts',
              value: restartValue,
              muted: proc.restart_time === 0,
              danger: restartDanger,
            },
          ];

          const selectBox = onToggleSelect ? (
            <input
              type="checkbox"
              checked={selectedIds?.has(proc.pm_id) ?? false}
              onChange={() => onToggleSelect(proc.pm_id)}
              aria-label={`Select ${proc.name}`}
              className="size-3.5 shrink-0 cursor-pointer rounded border-border bg-surface-muted accent-brand-500"
            />
          ) : null;

          const actions = (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground',
                  !compact && 'sm:px-2.5',
                  logsOpen && 'bg-accent text-foreground',
                )}
                onClick={() => setExpandedLogs(logsOpen ? null : String(proc.pm_id))}
                title={logsOpen ? 'Hide logs' : 'View logs'}
              >
                <ScrollText className="size-3.5" />
                <span className={cn(compact ? 'hidden' : 'hidden sm:inline')}>
                  {logsOpen ? 'Hide logs' : 'Logs'}
                </span>
              </Button>

              {isOnline ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => runAction('stop', proc)}
                  disabled={!!isLoading('stop')}
                  title="Stop"
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-emerald-400"
                  onClick={() => runAction('restart', proc)}
                  disabled={!!isLoading('restart')}
                  title="Start"
                >
                  <Play className="size-3.5" />
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => runAction('restart', proc)}
                    disabled={!!isLoading('restart')}
                  >
                    <RotateCw className="mr-2 size-4" />
                    Restart
                  </DropdownMenuItem>
                  {isOnline && (
                    <DropdownMenuItem
                      onClick={() => runAction('reload', proc)}
                      disabled={!!isLoading('reload')}
                    >
                      <RefreshCcw className="mr-2 size-4" />
                      Reload (graceful)
                    </DropdownMenuItem>
                  )}
                  {isOnline && (
                    <DropdownMenuItem
                      onClick={() => runAction('stop', proc)}
                      disabled={!!isLoading('stop')}
                    >
                      <Square className="mr-2 size-4" />
                      Stop
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(proc)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );

          const logPanel = logsOpen ? (
            <div
              className={cn(
                'overflow-hidden border border-border',
                compact ? 'rounded-b-xl' : 'rounded-b-2xl',
              )}
            >
              <ProcessLogViewer
                target={String(proc.pm_id)}
                processName={proc.name}
                onClose={() => setExpandedLogs(null)}
              />
            </div>
          ) : null;

          const cardClassName = cn(
            'relative gap-0 overflow-hidden border border-border bg-card p-0 shadow-sm transition-colors',
            compact ? 'rounded-xl' : 'rounded-2xl',
            logsOpen ? 'rounded-b-none border-b-transparent' : 'hover:border-border-strong',
          );

          if (compact) {
            return (
              <div key={proc.pm_id}>
                <Card className={cardClassName}>
                  <span className={cn('absolute inset-y-0 left-0 w-0.5', sc.rail)} aria-hidden />
                  <div className="flex items-center gap-2.5 px-3 py-2">
                    {selectBox}
                    <span className={cn('size-2 shrink-0 rounded-full', sc.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {proc.name}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[10px] font-semibold uppercase tracking-wider',
                            sc.color,
                          )}
                        >
                          {sc.label}
                        </span>
                        <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                          #{proc.pm_id}
                        </span>
                      </div>
                      <p
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={commandTitle}
                      >
                        {command}
                      </p>
                    </div>

                    {isOnline && (
                      <div className="hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground lg:flex">
                        <span className="flex items-center gap-1 tabular-nums" title="CPU">
                          <Cpu className="size-3" />
                          <span className="font-mono text-foreground">
                            {proc.monit.cpu.toFixed(1)}%
                          </span>
                        </span>
                        <span className="flex items-center gap-1 tabular-nums" title="Memory">
                          <MemoryStick className="size-3" />
                          <span className="font-mono text-foreground">
                            {formatBytes(proc.monit.memory)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 tabular-nums" title="Uptime">
                          <Clock className="size-3" />
                          <span className="font-mono text-foreground">
                            {formatUptime(proc.pm_uptime)}
                          </span>
                        </span>
                        {proc.restart_time > 0 && (
                          <span className="flex items-center gap-1 tabular-nums" title="Restarts">
                            <RotateCw className="size-3" />
                            <span
                              className={cn(
                                'font-mono',
                                restartDanger ? 'text-red-400' : 'text-foreground',
                              )}
                            >
                              {restartValue}
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {actions}
                  </div>
                </Card>
                {logPanel}
              </div>
            );
          }

          return (
            <div key={proc.pm_id}>
              <Card className={cardClassName}>
                <span className={cn('absolute inset-y-0 left-0 w-0.5', sc.rail)} aria-hidden />
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {selectBox && <div className="pt-0.5">{selectBox}</div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                            {proc.name}
                          </h3>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'gap-1.5 border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                              sc.bg,
                              sc.color,
                            )}
                          >
                            <span className={cn('size-1.5 rounded-full', sc.dot)} />
                            {sc.label}
                          </Badge>
                          <span className="hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">
                            #{proc.pm_id}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span
                            className="inline-flex min-w-0 max-w-[280px] items-center gap-1.5 font-mono"
                            title={commandTitle}
                          >
                            <Terminal className="size-3.5 shrink-0 opacity-60" />
                            <span className="truncate">{command}</span>
                          </span>
                          {isOnline && proc.pid > 0 && (
                            <span className="tabular-nums">PID {proc.pid}</span>
                          )}
                          <span>{formatExecMode(proc.exec_mode)}</span>
                          {proc.instances > 1 && (
                            <span>
                              {proc.instances} instance{proc.instances === 1 ? '' : 's'}
                            </span>
                          )}
                          {proc.status === 'errored' && proc.exit_code != null && (
                            <span className="text-red-400">exit {proc.exit_code}</span>
                          )}
                          {proc.unstable_restarts > 0 && (
                            <span className="text-amber-400">
                              {proc.unstable_restarts} unstable restart
                              {proc.unstable_restarts === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {actions}
                  </div>

                  {/* Metrics strip */}
                  <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
                    {metrics.map((metric) => (
                      <MetricCell key={metric.label} {...metric} />
                    ))}
                  </div>
                </div>
              </Card>
              {logPanel}
            </div>
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete process</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop <strong>{deleteTarget?.name}</strong> and remove it from PM0. Its pm_id
              may be reused. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) runAction('delete', deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
