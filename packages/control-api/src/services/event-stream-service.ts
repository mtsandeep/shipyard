type Listener = (chunk: string) => void;

function formatSSE(event: string, data: any): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

class EventStreamServiceClass {
  private buildListeners = new Map<string, Set<Listener>>();
  private projectListeners = new Map<string, Set<Listener>>();
  private emptyRoomsWarned = new Set<string>();

  private buildSubscriberCount(buildId: string): number {
    return this.buildListeners.get(buildId)?.size ?? 0;
  }

  private projectSubscriberCount(projectId: string): number {
    return this.projectListeners.get(projectId)?.size ?? 0;
  }

  /**
   * Helper to create a standard SSE Response for a given subscriber callback.
   */
  createSSEResponse(subscribe: (send: (chunk: string) => void) => () => void): Response {
    let unsubscribe: (() => void) | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Initial comment so client knows the SSE stream is connected
        controller.enqueue(encoder.encode(': connected\n\n'));

        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Stream might have closed
          }
        };

        unsubscribe = subscribe(send);

        // Keepalive heartbeat ping every 15s to keep proxy/Cloudflare connections alive
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
          }
        }, 15000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (unsubscribe) unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Critical for Nginx
      },
    });
  }

  /**
   * Subscribe to live logs for a specific build via SSE
   */
  subscribeBuild(buildId: string): Response {
    return this.createSSEResponse((send) => {
      if (!this.buildListeners.has(buildId)) {
        this.buildListeners.set(buildId, new Set());
      }
      this.buildListeners.get(buildId)!.add(send);
      this.emptyRoomsWarned.delete(`build:${buildId}`);
      console.log(
        `[SSE] Client subscribed to build:${buildId} (subscribers: ${this.buildSubscriberCount(buildId)})`,
      );

      return () => {
        const set = this.buildListeners.get(buildId);
        if (set) {
          set.delete(send);
          console.log(`[SSE] Client unsubscribed from build:${buildId} (subscribers: ${set.size})`);
          if (set.size === 0) {
            this.buildListeners.delete(buildId);
          }
        }
      };
    });
  }

  /**
   * Subscribe to project status events (build updates, deployment updates, domain status) via SSE
   */
  subscribeProject(projectId: string): Response {
    return this.createSSEResponse((send) => {
      if (!this.projectListeners.has(projectId)) {
        this.projectListeners.set(projectId, new Set());
      }
      this.projectListeners.get(projectId)!.add(send);
      console.log(
        `[SSE] Client subscribed to project:${projectId} (subscribers: ${this.projectSubscriberCount(projectId)})`,
      );

      return () => {
        const set = this.projectListeners.get(projectId);
        if (set) {
          set.delete(send);
          console.log(
            `[SSE] Client unsubscribed from project:${projectId} (subscribers: ${set.size})`,
          );
          if (set.size === 0) {
            this.projectListeners.delete(projectId);
          }
        }
      };
    });
  }

  /**
   * Broadcast a build log line to all SSE subscribers of the build room.
   */
  broadcast(
    buildId: string,
    message: string,
    level: string = 'info',
    meta: { id?: string; timestamp?: string } = {},
  ) {
    const room = `build:${buildId}`;
    const subscribers = this.buildSubscriberCount(buildId);

    if (subscribers === 0) {
      if (!this.emptyRoomsWarned.has(room)) {
        this.emptyRoomsWarned.add(room);
        console.warn(
          `[SSE] broadcast -> ${room} has 0 subscribers; logs are persisted but not streamed live`,
        );
      }
      return;
    } else if (this.emptyRoomsWarned.has(room)) {
      this.emptyRoomsWarned.delete(room);
      console.log(`[SSE] ${room} subscribers: ${subscribers}`);
    }

    const payload = {
      buildId,
      data: message,
      level,
      ...meta,
    };
    const sseMessage = formatSSE('build_log', payload);

    const listeners = this.buildListeners.get(buildId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(sseMessage);
        } catch (err) {
          console.error('[SSE] Failed to deliver build log to listener:', err);
        }
      }
    }
  }

  broadcastBuildUpdate(projectId: string, payload: any) {
    const listeners = this.projectListeners.get(projectId);
    if (!listeners || listeners.size === 0) return;
    const sseMessage = formatSSE('build_updated', payload);
    for (const listener of listeners) {
      try {
        listener(sseMessage);
      } catch (err) {
        console.error('[SSE] Failed to deliver build_updated to listener:', err);
      }
    }
  }

  broadcastDeploymentUpdate(projectId: string, payload: any) {
    const listeners = this.projectListeners.get(projectId);
    if (!listeners || listeners.size === 0) return;
    const sseMessage = formatSSE('deployment_updated', payload);
    for (const listener of listeners) {
      try {
        listener(sseMessage);
      } catch (err) {
        console.error('[SSE] Failed to deliver deployment_updated to listener:', err);
      }
    }
  }

  broadcastDomainStatus(projectId: string, payload: any) {
    const listeners = this.projectListeners.get(projectId);
    if (!listeners || listeners.size === 0) return;
    const sseMessage = formatSSE('domain_status', payload);
    for (const listener of listeners) {
      try {
        listener(sseMessage);
      } catch (err) {
        console.error('[SSE] Failed to deliver domain_status to listener:', err);
      }
    }
  }
}

export const EventStreamService = new EventStreamServiceClass();
