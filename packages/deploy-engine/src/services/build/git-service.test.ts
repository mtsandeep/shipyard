import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { GitService } from './git-service';

describe('repository clone diagnostics', () => {
  let directory: string;
  let repository: string;

  async function git(args: string[]) {
    const child = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error(stderr || stdout);
    return stdout;
  }

  beforeAll(async () => {
    directory = await mkdtemp('/tmp/opencode/shipyard-clone-');
    repository = join(directory, 'repository');
    await git(['init', '--initial-branch=main', repository]);
    await mkdir(join(repository, 'client'));
    await mkdir(join(repository, 'server'));
    await writeFile(join(repository, 'client', 'index.html'), 'client');
    await writeFile(join(repository, 'server', 'index.ts'), 'server');
    await git(['-C', repository, 'add', '.']);
    await git([
      '-C', repository,
      '-c', 'user.name=Shipyard Test',
      '-c', 'user.email=test@example.com',
      'commit', '--no-gpg-sign', '-m', 'fixture',
    ]);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test('clones the same complete workspace for both frontend and backend with stage timings', async () => {
    for (const app of ['client', 'server']) {
      const target = join(directory, `${app}-build`);
      const messages: string[] = [];
      await GitService.clone(repository, target, undefined, (message) => messages.push(message));
      expect(await readFile(join(target, 'client', 'index.html'), 'utf8')).toBe('client');
      expect(await readFile(join(target, 'server', 'index.ts'), 'utf8')).toBe('server');
      expect(messages.some((message) => message.includes('Repository directory prepared in'))).toBe(true);
      expect(messages.some((message) => message.includes('Git clone completed in'))).toBe(true);
      expect(messages.every((message) => /^\[\d{4}-\d{2}-\d{2}T/.test(message))).toBe(true);
    }
  });

  test('removes partial retry output before cloning', async () => {
    const target = join(directory, 'retry');
    await mkdir(join(target, 'node_modules', 'partial'), { recursive: true });
    await writeFile(join(target, 'node_modules', 'partial', 'old.js'), 'partial install');
    await GitService.clone(repository, target);
    expect(await Bun.file(join(target, 'node_modules', 'partial', 'old.js')).exists()).toBe(false);
    expect(await readFile(join(target, 'client', 'index.html'), 'utf8')).toBe('client');
  });

  test('reports completed preparation separately when the Git operation fails', async () => {
    const messages: string[] = [];
    await expect(
      GitService.clone(join(directory, 'missing-repository'), join(directory, 'failed-build'), undefined,
        (message) => messages.push(message)),
    ).rejects.toThrow();
    expect(messages.some((message) => message.includes('Repository directory prepared in'))).toBe(true);
    expect(messages.some((message) => message.includes('Git clone completed in'))).toBe(false);
  });
});
