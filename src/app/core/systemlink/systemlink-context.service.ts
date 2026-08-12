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
    if (!this.workspaceIdCache) {
      this.workspaceIdCache = this.fetchWorkspaceId();
    }
    return this.workspaceIdCache;
  }

  private extractWorkspaceName(): string {
    // Webapp URL path: /webapps/app/{WorkspaceName}/{AppName}/...
    const parts = window.location.pathname.split('/').filter(Boolean);
    const appIdx = parts.indexOf('app');
    if (appIdx >= 0 && parts[appIdx + 1]) {
      return decodeURIComponent(parts[appIdx + 1]);
    }
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
      const match = (workspaces as Record<string, unknown>[]).find(w => w['name'] === name);
      return match ? String(match['id']) : null;
    } catch {
      return null;
    }
  }
}
