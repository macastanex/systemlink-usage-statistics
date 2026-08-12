import { Injectable } from '@angular/core';

import { SystemLinkContextService } from './systemlink-context.service';

@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  constructor(private readonly context: SystemLinkContextService) {}

  async checkIsSuperUser(): Promise<boolean> {
    try {
      const response = await fetch(
        this.context.buildApiUrl('/niauth/v1/auth'),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as unknown;
      return this.payloadIndicatesAdmin(payload);
    } catch {
      return false;
    }
  }

  private payloadIndicatesAdmin(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const text = JSON.stringify(payload);

    // Match common admin role strings from the SystemLink auth response
    if (/server.?administrator/i.test(text) || /super.?user/i.test(text)) {
      return true;
    }

    // Also check structured policy arrays for admin role names
    return this.hasAdminRoleInPolicies(payload as Record<string, unknown>);
  }

  private hasAdminRoleInPolicies(record: Record<string, unknown>): boolean {
    const candidateKeys = ['policies', 'roles', 'assignments', 'userPolicies', 'policyTemplates'];

    for (const key of candidateKeys) {
      const arr = record[key];
      if (!Array.isArray(arr)) {
        continue;
      }

      for (const item of arr) {
        if (typeof item === 'string') {
          if (/server.?administrator|super.?user/i.test(item)) {
            return true;
          }
          continue;
        }

        if (!item || typeof item !== 'object') {
          continue;
        }

        const entry = item as Record<string, unknown>;
        const nameFields = ['name', 'displayName', 'templateName', 'roleName', 'role'];
        for (const field of nameFields) {
          if (typeof entry[field] === 'string' && /server.?administrator|super.?user/i.test(entry[field] as string)) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
