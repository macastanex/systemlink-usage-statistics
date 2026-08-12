import { Injectable } from '@angular/core';

export type AuthMode = 'same-origin' | 'api-key';

@Injectable({ providedIn: 'root' })
export class SystemLinkContextService {
  readonly appName = 'systemlink-usage-statistics';
  readonly publishName = 'Systemlink Usage Statistics';
  readonly authMode: AuthMode = 'same-origin';

  private workspaceIdCache: Promise<string | null> | null = null;

  get workspaceName(): string {
    return this.extractWorkspaceName();
  }

  get origin(): string {
    return window.location.origin;
  }

  buildApiUrl(servicePath: string): string {
    return `${this.origin}/${servicePath.replace(/^\/+/, '')}`;
  }

  buildRequestInit(init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers ?? {});
    if (this.authMode === 'api-key') {
      const apiKey = window.localStorage.getItem('slcli.webapp.apiKey');
      if (apiKey) {
        headers.set('x-ni-api-key', apiKey);
      }
    }

    return {
      ...init,
      credentials: this.authMode === 'same-origin' ? 'include' : init.credentials,
      headers,
    };
  }

  // Resolves the workspace ID matching the webapp's deployed workspace (from URL path).
  resolveWorkspaceId(): Promise<string | null> {
    // Don't cache null — if lookup failed, retry on next call
    if (!this.workspaceIdCache) {
      const p = this.fetchWorkspaceId();
      p.then(id => { if (id) this.workspaceIdCache = p; });
    }
    return this.workspaceIdCache ?? this.fetchWorkspaceId();
  }

  private extractWorkspaceName(): string {
    try {
      const parent = window.parent !== window ? window.parent : window;
      // Check both pathname and hash to handle SPA hash-based routing
      const candidates = [parent.location.pathname, parent.location.hash];
      for (const source of candidates) {
        const parts = source.split('/').filter(Boolean);
        const appIdx = parts.indexOf('app');
        if (appIdx >= 0 && parts[appIdx + 1]) {
          const name = decodeURIComponent(parts[appIdx + 1]);
          console.debug('[SystemLinkContext] detected workspace name:', name, 'from', source);
          return name;
        }
      }
    } catch {
      // cross-origin parent — fall through to default
    }
    console.debug('[SystemLinkContext] workspace name not found in URL, using Default');
    return 'Default';
  }

  private async fetchWorkspaceId(): Promise<string | null> {
    try {
      const name = this.extractWorkspaceName();
      const response = await fetch(
        this.buildApiUrl('/niuser/v1/workspaces'),
        this.buildRequestInit({ method: 'GET' }),
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as Record<string, unknown>;
      const workspaces = payload['workspaces'];
      if (!Array.isArray(workspaces)) return null;
      // Case-insensitive match so URL capitalisation doesn't matter
      const lower = name.toLowerCase();
      const match = (workspaces as Record<string, unknown>[]).find(
        w => String(w['name']).toLowerCase() === lower,
      );
      const id = match ? String(match['id']) : null;
      console.debug('[SystemLinkContext] workspace ID resolved:', id, 'for name:', name);
      return id;
    } catch {
      return null;
    }
  }
}
