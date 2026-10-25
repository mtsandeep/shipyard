'use client';

import { useEffect, useState, useCallback } from 'react';
import { pm0Api, PM0Process, PM0Health, PM0SystemStats } from '@/lib/pm0-api';
import { ProcessTable } from '@/components/process-manager/process-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';
import {
  Search,
  Loader2,
  Save,
  RefreshCw,
  Activity,
  Cpu,
  MemoryStick,
  AlertTriangle,
  Boxes,
  Gauge,
  List,
  LayoutGrid,
  Square,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

type KpiTone = 'default' | 'positive' | 'warning' | 'danger';

const toneStyles: Record<KpiTone, { icon: string; bar: string }> = {
  default: {
    icon: 'border-border bg-surface-muted text-muted-foreground',
    bar: 'bg-foreground/40',
  },
  positive: {
    icon: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
    bar: 'bg-emerald-500',
  },
  warning: {
    icon: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
    bar: 'bg-amber-500',
  },
  danger: {
    icon: 'border-red-500/20 bg-red-500/10 text-red-400',
    bar: 'bg-red-500',
  },
};

function getPressureTone(pct: number): KpiTone {
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warning';
  return 'default';
}

interface KpiCardProps {
  icon: typeof Activity;
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: KpiTone;
  progress?: number | null;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  tone = 'default',
  progress,
}: KpiCardProps) {
  const styles = toneStyles[tone];
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress));

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <span
          className={cn('grid size-6 shrink-0 place-items-center rounded-md border', styles.icon)}
        >
          <Icon className="size-3" />
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-lg font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-xl">
          {value}
        </span>
        {unit && <span className="text-[10px] font-medium text-muted-foreground">{unit}</span>}
      </div>
      <p className="mt-1 min-h-3.5 truncate text-[11px] text-muted-foreground" title={hint}>
        {hint}
      </p>
      {pct !== null && (
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', styles.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

type StatusFilter = 'all' | 'online' | 'stopped' | 'errored';

const filterDot: Record<StatusFilter, string | null> = {
  all: null,
  online: 'bg-emerald-400',
  stopped: 'bg-zinc-400',
  errored: 'bg-red-400',
};

export default function ProcessesPage() {
  const [processes, setProcesses] = useState<PM0Process[]>([]);
  const [health, setHealth] = useState<PM0Health | null>(null);
  const [system, setSystem] = useState<PM0SystemStats | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [compact, setCompact] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'stop' | 'restart' | 'delete' | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [daemonDown, setDaemonDown] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [list, h] = await Promise.all([pm0Api.getProcessesWithSystem(), pm0Api.getHealth()]);
      setProcesses(list.processes);
      setSystem(list.system);
      setHealth(h);
      setDaemonDown(false);
    } catch {
      setDaemonDown(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Drop selections for processes that no longer exist.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(processes.map((p) => p.pm_id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [processes]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await pm0Api.saveDump();
      toast.success(`Saved ${result.saved_count} process(es) to dump`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const searchedProcesses = processes.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      String(p.pm_id).includes(search) ||
      p.status.toLowerCase().includes(search.toLowerCase()),
  );

  const filterCounts: Record<StatusFilter, number> = {
    all: searchedProcesses.length,
    online: searchedProcesses.filter((p) => p.status === 'online').length,
    stopped: searchedProcesses.filter((p) => p.status === 'stopped').length,
    errored: searchedProcesses.filter((p) => p.status === 'errored').length,
  };

  const filteredProcesses =
    statusFilter === 'all'
      ? searchedProcesses
      : searchedProcesses.filter((p) => p.status === statusFilter);

  const selectedProcesses = processes.filter((p) => selectedIds.has(p.pm_id));
  const allVisibleSelected =
    filteredProcesses.length > 0 && filteredProcesses.every((p) => selectedIds.has(p.pm_id));

  const toggleSelect = (pmId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pmId)) next.delete(pmId);
      else next.add(pmId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProcesses.map((p) => p.pm_id)));
    }
  };

  const runBulkAction = async (action: 'stop' | 'restart' | 'delete') => {
    const targets =
      action === 'stop'
        ? selectedProcesses.filter((p) => p.status === 'online')
        : selectedProcesses;

    if (targets.length === 0) {
      toast.error(action === 'stop' ? 'No running processes selected' : 'No processes selected');
      return;
    }

    setBulkAction(action);
    const results = await Promise.allSettled(
      targets.map((p) =>
        action === 'stop'
          ? pm0Api.stopProcess(String(p.pm_id))
          : action === 'restart'
            ? pm0Api.restartProcess(String(p.pm_id))
            : pm0Api.deleteProcess(String(p.pm_id)),
      ),
    );

    const failed = results.filter((result) => result.status === 'rejected').length;
    const succeeded = results.length - failed;
    const verb = action === 'stop' ? 'stopped' : action === 'restart' ? 'restarted' : 'deleted';

    if (succeeded > 0) {
      toast.success(`${succeeded} process${succeeded === 1 ? '' : 'es'} ${verb}`);
    }
    if (failed > 0) {
      toast.error(`${failed} process${failed === 1 ? '' : 'es'} failed to ${action}`);
    }

    setSelectedIds(new Set());
    setBulkAction(null);
    setBulkDeleteOpen(false);
    fetchData();
  };

  // Aggregated stats
  const onlineCount = processes.filter((p) => p.status === 'online').length;
  const stoppedCount = processes.filter((p) => p.status === 'stopped').length;
  const erroredCount = processes.filter((p) => p.status === 'errored').length;
  const inactiveCount = processes.length - onlineCount;
  const totalCpu = processes.reduce((sum, p) => sum + (p.monit?.cpu ?? 0), 0);
  const totalMem = processes.reduce((sum, p) => sum + (p.monit?.memory ?? 0), 0);

  const processMemPct =
    system?.has_memory && system.memory_total_bytes > 0
      ? (totalMem / system.memory_total_bytes) * 100
      : null;

  const hostLoadPct =
    system?.has_load && system.cpu_cores > 0 ? (system.load_1 / system.cpu_cores) * 100 : null;

  const onlineTone: KpiTone = erroredCount
    ? 'danger'
    : stoppedCount
      ? 'warning'
      : processes.length
        ? 'positive'
        : 'default';

  const onlineHint = erroredCount
    ? `${erroredCount} errored${stoppedCount ? ` · ${stoppedCount} stopped` : ''}`
    : stoppedCount
      ? `${stoppedCount} stopped`
      : processes.length
        ? 'All processes healthy'
        : 'No processes running';

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'online', label: 'Online' },
    { key: 'stopped', label: 'Stopped' },
    { key: 'errored', label: 'Errored' },
  ];

  return (
    <div className="pb-24">
      {/* Sticky header */}
      <header className="sticky top-[68px] z-10 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Processes</h1>
              {health && (
                <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                  pm0 v{health.version}
                </Badge>
              )}
              {daemonDown && (
                <Badge variant="destructive" className="gap-1.5 text-xs">
                  <AlertTriangle className="size-3" />
                  Daemon offline
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search processes..."
                  className="h-9 pl-9"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedIds(new Set());
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={fetchData}
                title="Refresh"
              >
                <RefreshCw className="size-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={handleSave}
                disabled={saving || processes.length === 0}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                <span className="hidden sm:inline">Save</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        {/* Stats cards */}
        {!loading && !daemonDown && (processes.length > 0 || system) && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <KpiCard
              icon={Boxes}
              label="Total"
              value={processes.length}
              hint={
                processes.length === 0
                  ? 'No supervised processes'
                  : `${onlineCount} online${inactiveCount ? ` · ${inactiveCount} inactive` : ''}`
              }
            />
            <KpiCard
              icon={Activity}
              label="Online"
              value={onlineCount}
              hint={onlineHint}
              tone={onlineTone}
            />
            <KpiCard
              icon={Cpu}
              label="Process CPU"
              value={totalCpu.toFixed(1)}
              unit="%"
              hint={`${onlineCount} running process${onlineCount === 1 ? '' : 'es'}`}
            />
            <KpiCard
              icon={MemoryStick}
              label="Process Memory"
              value={formatBytes(totalMem)}
              hint={
                processMemPct === null
                  ? 'Resident memory used'
                  : `${processMemPct.toFixed(1)}% of host memory`
              }
              tone={processMemPct === null ? 'default' : getPressureTone(processMemPct)}
              progress={processMemPct}
            />
            {system && (
              <>
                <KpiCard
                  icon={Gauge}
                  label="Host CPU"
                  value={system.has_load ? system.load_1.toFixed(2) : '—'}
                  unit={system.has_load ? 'load' : undefined}
                  hint={
                    system.has_load
                      ? `${system.cpu_cores} cores · 5m ${system.load_5.toFixed(2)} · 15m ${system.load_15.toFixed(2)}`
                      : 'Load unavailable'
                  }
                  tone={hostLoadPct === null ? 'default' : getPressureTone(hostLoadPct)}
                  progress={hostLoadPct}
                />
                <KpiCard
                  icon={MemoryStick}
                  label="Host Memory"
                  value={system.has_memory ? system.memory_used_pct.toFixed(1) : '—'}
                  unit={system.has_memory ? '%' : undefined}
                  hint={
                    system.has_memory
                      ? `${formatBytes(system.memory_used_bytes)} / ${formatBytes(system.memory_total_bytes)}`
                      : 'Memory unavailable'
                  }
                  tone={system.has_memory ? getPressureTone(system.memory_used_pct) : 'default'}
                  progress={system.has_memory ? system.memory_used_pct : null}
                />
              </>
            )}
            {health && (
              <div className="col-span-2 rounded-2xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Daemon
                    </p>
                    <p className="mt-1.5 font-mono text-xs font-medium text-foreground tabular-nums">
                      PID {health.pid}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Running
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="mt-0.5 font-mono text-foreground">
                      v{health.version}
                      {health.commit ? ` · ${health.commit.slice(0, 7)}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Kill mode</dt>
                    <dd
                      className="mt-0.5 truncate font-mono text-foreground"
                      title={health.kill_mode}
                    >
                      {health.kill_mode}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Kernel</dt>
                    <dd
                      className="mt-0.5 truncate font-mono text-foreground"
                      title={health.kernel_release}
                    >
                      {health.kernel_release}
                    </dd>
                  </div>
                </dl>
                {health.cgroup_warning && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle className="mt-px size-3 shrink-0" />
                    {health.cgroup_warning}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Process list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : daemonDown ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 px-6 py-16 text-center sm:py-20">
            <div className="mb-4 grid size-14 place-items-center rounded-full border border-destructive/30 bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">PM0 daemon is unreachable</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Make sure the PM0 daemon is running with the HTTP API enabled on{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                127.0.0.1:9615
              </code>
            </p>
            <Button variant="outline" className="mt-6" onClick={fetchData}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Supervised processes
                </h2>
                <Badge variant="secondary" className="text-[10px] font-medium tabular-nums">
                  {filteredProcesses.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {filteredProcesses.length > 0 && (
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={handleSelectAll}
                      aria-label="Select all visible processes"
                      className="size-3.5 cursor-pointer rounded border-border bg-surface-muted accent-brand-500"
                    />
                    <span className="hidden sm:inline">Select all</span>
                  </label>
                )}
                <Button
                  variant={compact ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => setCompact((value) => !value)}
                  title="Toggle compact list"
                >
                  {compact ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                  <span className="hidden sm:inline">{compact ? 'Comfortable' : 'Compact'}</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {statusFilters.map((filter) => {
                const active = statusFilter === filter.key;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => {
                      setStatusFilter(filter.key);
                      setSelectedIds(new Set());
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-border-strong bg-surface-muted text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-surface-muted/60 hover:text-foreground',
                    )}
                  >
                    {filterDot[filter.key] && (
                      <span className={cn('size-1.5 rounded-full', filterDot[filter.key])} />
                    )}
                    {filter.label}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                        active
                          ? 'bg-background text-foreground'
                          : 'bg-surface-muted text-muted-foreground',
                      )}
                    >
                      {filterCounts[filter.key]}
                    </span>
                  </button>
                );
              })}
            </div>

            <ProcessTable
              processes={filteredProcesses}
              onRefresh={fetchData}
              compact={compact}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />

            {selectedIds.size > 0 && (
              <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-popover/95 px-3 py-2 shadow-xl backdrop-blur">
                <span className="mr-auto text-xs font-medium text-foreground">
                  {selectedIds.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => runBulkAction('stop')}
                  disabled={!!bulkAction}
                  title="Stop selected"
                >
                  {bulkAction === 'stop' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Square className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">Stop</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => runBulkAction('restart')}
                  disabled={!!bulkAction}
                  title="Restart selected"
                >
                  {bulkAction === 'restart' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">Restart</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={!!bulkAction}
                  title="Delete selected"
                >
                  <Trash2 className="size-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedIds(new Set())}
                  title="Clear selection"
                  aria-label="Clear selection"
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} process{selectedIds.size === 1 ? '' : 'es'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will stop and remove the selected processes from PM0. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAction === 'delete'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkAction === 'delete'}
              onClick={(event) => {
                event.preventDefault();
                void runBulkAction('delete');
              }}
            >
              {bulkAction === 'delete' && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
