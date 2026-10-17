import { describe, expect, spyOn, test } from 'bun:test';
import * as exec from './exec';
import { PM0Service } from './index';
import {
  getProcessBuildId,
  getProcessProjectId,
  matchesProject,
  type PM0ProcessInfo,
} from './types';

const process: PM0ProcessInfo = {
  name: 'syncvibe',
  pm_id: 7,
  monit: { memory: 0, cpu: 0 },
  pm2_env: {
    status: 'online',
    pm_uptime: 0,
    restart_time: 0,
    pm_cwd: '/var/lib/shipyard/apps/example',
    env: { DEPLOY_PROJECT_ID: 'project-123', DEPLOY_BUILD_ID: 'build-456', PORT: '5001' },
  },
};

describe('pm0 project ownership and static migration', () => {
  test('finds a name-based application using pm0 nested environment variables', () => {
    expect(getProcessProjectId(process)).toBe('project-123');
    expect(getProcessBuildId(process)).toBe('build-456');
    expect(matchesProject(process, 'project-123')).toBe(true);
    expect(matchesProject(process, 'another-project')).toBe(false);
  });

  test('retains flattened PM2 and legacy process-name compatibility', () => {
    const flattened = {
      ...process,
      pm2_env: { ...process.pm2_env, env: undefined, DEPLOY_PROJECT_ID: 'project-123' },
    };
    expect(matchesProject(flattened, 'project-123')).toBe(true);
    const legacy = {
      ...process,
      name: 'deploy-project-',
      pm2_env: { ...process.pm2_env, env: undefined },
    };
    expect(matchesProject(legacy, 'project-123')).toBe(true);
    expect(matchesProject({ ...process, name: 'deploy-another-' }, 'another-project')).toBe(false);
  });

  test('deletes the actual named process by ID before handing its port to Nginx', async () => {
    const command = spyOn(exec, 'execPm0').mockImplementation(async (args) => ({
      exitCode: 0,
      stdout: args[0] === 'jlist' ? JSON.stringify([process]) : '',
      stderr: '',
    }));
    try {
      expect(await PM0Service.findProcessByProjectId('project-123')).toEqual({
        name: 'syncvibe',
        pm_id: 7,
      });
      expect(await PM0Service.isRunning('project-123')).toBe(true);
      expect(await PM0Service.list()).toEqual([
        { name: 'syncvibe', projectId: 'project-123', buildId: 'build-456', status: 'online' },
      ]);
      expect(await PM0Service.delete('project-123')).toBe(true);
      expect(command).toHaveBeenCalledWith(['delete', '7']);
      expect(command).toHaveBeenCalledWith(['save']);
    } finally {
      command.mockRestore();
    }
  });
});
