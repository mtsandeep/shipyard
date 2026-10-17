import { mkdir, rm } from 'fs/promises';
import simpleGit from 'simple-git';

/**
 * Clones a repository into the deployment directory.
 * When an installation token is provided the repo is cloned over HTTPS using it.
 */
export const GitService = {
  async clone(
    repoUrl: string,
    targetDir: string,
    token?: string,
    onProgress?: (message: string) => void,
  ) {
    let urlToClone = repoUrl;
    if (token) {
      const urlObj = new URL(repoUrl);
      urlToClone = `https://x-access-token:${token}@${urlObj.hostname}${urlObj.pathname}`;
    }

    const startedAt = performance.now();
    let lastReportAt = startedAt;
    let phase = 'Preparing repository directory';
    const report = (message: string) => {
      lastReportAt = performance.now();
      onProgress?.(
        `[${new Date().toISOString()}] ${message} (${((lastReportAt - startedAt) / 1000).toFixed(1)}s elapsed)`,
      );
    };
    // Git can spend time connecting before it emits transfer progress. Keep that
    // interval visible, and include producer timestamps to expose delayed delivery.
    const heartbeat = setInterval(() => {
      if (performance.now() - lastReportAt >= 5000) report(`${phase}...`);
    }, 5000);

    try {
      report(phase);
      // A retry may contain a large partial checkout/node_modules tree. Removing
      // it synchronously blocks all build log flushing on the worker's event loop.
      await rm(targetDir, { recursive: true, force: true });
      await mkdir(targetDir, { recursive: true });
      const cloneStartedAt = performance.now();
      report(`Repository directory prepared in ${((cloneStartedAt - startedAt) / 1000).toFixed(1)}s`);

      phase = 'Git connecting/downloading repository';
      report(phase);
      let previousStage = '';
      const git = simpleGit({
        progress: ({ stage, progress, processed, total }) => {
          phase = `Git ${stage}: ${progress}% (${processed}/${total})`;
          if (stage !== previousStage || performance.now() - lastReportAt >= 5000) {
            previousStage = stage;
            report(phase);
          }
        },
      });
      await git.clone(urlToClone, targetDir, ['--progress']);
      report(`Git clone completed in ${((performance.now() - cloneStartedAt) / 1000).toFixed(1)}s`);
    } finally {
      clearInterval(heartbeat);
    }
  },
};
