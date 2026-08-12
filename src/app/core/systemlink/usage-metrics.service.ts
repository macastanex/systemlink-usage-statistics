import { Injectable } from '@angular/core';

import { SystemLinkContextService } from './systemlink-context.service';

export interface UsageMetric {
  key: string;
  label: string;
  detail: string;
  value: number | null;
  source: string;
  status: 'ok' | 'unavailable' | 'unauthorized';
}

export interface UsageDashboardModel {
  metrics: UsageMetric[];
  unavailable: string[];
  refreshedAt: string;
}

type CountParser = (payload: unknown) => number | null;

interface CountRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

interface CountAttempt {
  request: CountRequest;
  value: number;
}

interface ProbeOutcome {
  attempt: CountAttempt | null;
  unauthorized: boolean;
}

interface RequestAttemptResult {
  value: number | null;
  unauthorized: boolean;
}

interface WorkItemTypeDefinition {
  type: string;
  label: string;
}

interface WorkItemTypeLookupResult {
  types: WorkItemTypeDefinition[];
  unauthorized: boolean;
}

interface WorkItemTypeCountResult {
  total: number | null;
  counts: Map<string, number>;
  unauthorized: boolean;
}

interface SystemsSummaryCounts {
  connected: number | null;
  disconnected: number | null;
  virtual: number | null;
  unauthorized: boolean;
}

interface FeedPackageCountResult {
  total: number | null;
  unauthorized: boolean;
}

interface RoutineStatusCounts {
  enabled: number | null;
  disabled: number | null;
  alarms: number | null;
  unauthorized: boolean;
}

interface CountProbe {
  label: string;
  key: string;
  detail: string;
  requests: CountRequest[];
  parser?: CountParser;
}

@Injectable({ providedIn: 'root' })
export class UsageMetricsService {
  private routineStatusCountsPromise: Promise<RoutineStatusCounts | null> | null = null;

  constructor(private readonly context: SystemLinkContextService) {}

  async load(onPartialUpdate?: (metrics: readonly UsageMetric[]) => void): Promise<UsageDashboardModel> {
    this.routineStatusCountsPromise = null;
    const refreshedAt = new Date().toISOString();
    const accumulated: UsageMetric[] = [];

    const probes: CountProbe[] = [
      {
        key: 'test-results',
        label: 'Test Results',
        detail: 'Total test results available to the current user.',
        requests: [
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-results',
            body: {
              filter: '',
              take: 0,
              continuationToken: null,
              returnCount: true,
              responseFormat: 'JSON',
            },
          },
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-results',
            body: {
              filter: '',
              take: 0,
              continuationToken: '',
              returnCount: true,
              responseFormat: 'JSON',
            },
          },
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-results',
            body: {
              take: 0,
              returnCount: true,
            },
          },
          {
            method: 'GET',
            path: '/nitestmonitor/v2/results?take=1&returnCount=true',
          },
        ],
      },
      {
        key: 'test-steps',
        label: 'Test Steps',
        detail: 'Total reported test steps (when exposed by Test Monitor summary APIs).',
        requests: [
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-steps',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-steps',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'GET',
            path: '/nitestmonitor/v2/steps?take=1&returnCount=true',
          },
        ],
        parser: (payload: unknown) => this.extractStepCount(payload),
      },
      {
        key: 'files',
        label: 'Files',
        detail: 'Total files in File Service.',
        requests: [
          {
            method: 'GET',
            path: '/nifile/v1/service-groups/Default/files?take=1',
          },
          {
            method: 'POST',
            path: '/nifile/v1/service-groups/Default/query-files',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/nifile/v1/service-groups/Default/query-files',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'POST',
            path: '/nifile/v1/service-groups/Default/query-files-linq',
            body: { take: 1 },
          },
        ],
      },
      {
        key: 'data-tables',
        label: 'Data Tables',
        detail: 'Total tables in DataFrame Service.',
        requests: [
          {
            method: 'POST',
            path: '/nidataframe/v1/query-tables',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/nidataframe/v1/query-tables',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'GET',
            path: '/nidataframe/v1/tables?take=1',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['tables']),
      },
      {
        key: 'products',
        label: 'Products',
        detail: 'Total test products in Test Monitor.',
        requests: [
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-products',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/nitestmonitor/v2/query-products',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'GET',
            path: '/nitestmonitor/v2/products?take=1&returnCount=true',
          },
        ],
      },
      {
        key: 'workspaces',
        label: 'Workspaces',
        detail: 'Total workspaces configured on the instance.',
        requests: [
          {
            method: 'GET',
            path: '/niuser/v1/workspaces',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['workspaces']),
      },
      {
        key: 'assets',
        label: 'Assets',
        detail: 'Total assets tracked by Asset Performance Management.',
        requests: [
          {
            method: 'POST',
            path: '/niapm/v1/query-assets',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'POST',
            path: '/niapm/v1/query-assets',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'GET',
            path: '/niapm/v1/asset-summary',
          },
          {
            method: 'GET',
            path: '/niapm/v1/assets?Take=1&ReturnCount=true',
          },
        ],
      },
      {
        key: 'enabled-routines',
        label: 'Enabled Routines',
        detail: 'Total enabled event-action routines.',
        requests: [
          {
            method: 'GET',
            path: '/niroutine/v2/routines?enabled=true&take=1',
          },
        ],
      },
      {
        key: 'disabled-routines',
        label: 'Disabled Routines',
        detail: 'Total disabled event-action routines.',
        requests: [
          {
            method: 'GET',
            path: '/niroutine/v2/routines?enabled=false&take=1',
          },
        ],
      },
      {
        key: 'systems',
        label: 'Total Systems',
        detail: 'Total systems reported by Systems Management summary.',
        requests: [
          {
            method: 'GET',
            path: '/nisysmgmt/v1/get-systems-summary',
          },
        ],
        parser: (payload: unknown) => this.extractSystemsSummaryTotal(payload),
      },
      {
        key: 'connected-systems',
        label: 'Connected Systems',
        detail: 'Connected systems reported by Systems Management summary.',
        requests: [
          {
            method: 'GET',
            path: '/nisysmgmt/v1/get-systems-summary',
          },
        ],
        parser: (payload: unknown) => this.extractSystemsSummaryConnected(payload),
      },
      {
        key: 'disconnected-systems',
        label: 'Disconnected Systems',
        detail: 'Disconnected systems reported by Systems Management summary.',
        requests: [
          {
            method: 'GET',
            path: '/nisysmgmt/v1/get-systems-summary',
          },
        ],
        parser: (payload: unknown) => this.extractSystemsSummaryDisconnected(payload),
      },
      {
        key: 'virtual-systems',
        label: 'Virtual Systems',
        detail: 'Virtual systems reported by Systems Management summary.',
        requests: [
          {
            method: 'GET',
            path: '/nisysmgmt/v1/get-systems-summary',
          },
        ],
        parser: (payload: unknown) => this.extractSystemsSummaryVirtual(payload),
      },
      {
        key: 'users',
        label: 'Users',
        detail: 'Total users available from User Management.',
        requests: [
          {
            method: 'POST',
            path: '/niuser/v1/users/query',
            body: { take: 1000 },
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['users']),
      },
      {
        key: 'roles',
        label: 'Roles',
        detail: 'Total role templates in Authorization service.',
        requests: [
          {
            method: 'GET',
            path: '/niauth/v1/policy-templates',
          },
          {
            method: 'GET',
            path: '/niauth/v1/policy-templates?take=5000',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['policyTemplates']),
      },
      {
        key: 'grafana-dashboards',
        label: 'Grafana Dashboards',
        detail: 'Total dashboards discoverable through embedded Grafana.',
        requests: [
          {
            method: 'GET',
            path: '/dashboardhost/login',
          },
          {
            method: 'GET',
            path: '/dashboardhost/api/search?type=dash-db',
          },
          {
            method: 'GET',
            path: '/dashboardhost/api/search?type=dash-db&limit=5000',
          },
          {
            method: 'GET',
            path: '/grafana/api/search?type=dash-db&query=&limit=5000',
          },
          {
            method: 'GET',
            path: '/grafana/api/search?type=dash-db&limit=5000',
          },
        ],
        parser: (payload: unknown) => this.extractArrayCount(payload),
      },
      {
        key: 'tags',
        label: 'Tags',
        detail: 'Total tags in Tag Service.',
        requests: [
          {
            method: 'GET',
            path: '/nitag/v2/tags-count',
          },
          {
            method: 'GET',
            path: '/nitag/v2/tags?take=1',
          },
        ],
      },
      {
        key: 'states',
        label: 'States',
        detail: 'Total software states.',
        requests: [
          {
            method: 'GET',
            path: '/nisystemsstate/v1/states?Take=1',
          },
          {
            method: 'GET',
            path: '/nisystemsstate/v1/states?Take=1&Skip=0',
          },
        ],
      },
      {
        key: 'feeds',
        label: 'Feeds',
        detail: 'Total package feeds.',
        requests: [
          {
            method: 'GET',
            path: '/nifeed/v1/feeds',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['feeds']),
      },
      {
        key: 'package-counts',
        label: 'Package Counts',
        detail: 'Total packages across all package feeds.',
        requests: [
          {
            method: 'GET',
            path: '/nifeed/v1/feeds',
          },
        ],
      },
      {
        key: 'alarm-routines',
        label: 'Routines With Alarm Actions',
        detail: 'Routines whose action list includes ALARM.',
        requests: [
          {
            method: 'GET',
            path: '/niroutine/v2/routines?actionType=ALARM&take=1',
          },
          {
            method: 'GET',
            path: '/niroutine/v2/routines?filter=actionType eq ALARM&take=1',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['routines']),
      },
      {
        key: 'web-applications',
        label: 'Web Applications',
        detail: 'Total published SystemLink web applications.',
        requests: [
          {
            method: 'GET',
            path: '/niapp/v1/webapps?take=1&includeTotalCount=true',
          },
          {
            method: 'POST',
            path: '/niapp/v1/webapps/query',
            body: { take: 1, includeTotalCount: true },
          },
          {
            method: 'POST',
            path: '/niapp/v1/webapps/query',
            body: { Take: 1, IncludeTotalCount: true },
          },
          {
            method: 'GET',
            path: '/niapp/v1/webapps?take=1000',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['webapps']),
      },
      {
        key: 'work-flows',
        label: 'Workflows',
        detail: 'Total workflow definitions in Work Item/Work Order services.',
        requests: [
          {
            method: 'POST',
            path: '/niworkitem/v1/query-workflows',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/niworkitem/v1/query-workflows',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'POST',
            path: '/niworkorder/v1/query-workflows',
            body: { take: 1, returnCount: true },
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['workflows']),
      },
      {
        key: 'work-item-templates',
        label: 'Work Item Templates',
        detail: 'Total work item templates in Test Plans.',
        requests: [
          {
            method: 'POST',
            path: '/niworkitem/v1/query-workitem-templates',
            body: { take: 1, returnCount: true },
          },
          {
            method: 'POST',
            path: '/niworkitem/v1/query-workitem-templates',
            body: { Take: 1, ReturnCount: true },
          },
          {
            method: 'GET',
            path: '/niworkitem/v1/workitem-templates?take=1',
          },
        ],
        parser: (payload: unknown) => this.extractCollectionCount(payload, ['workItemTemplates']),
      },
    ];

    const baseMetricPromises = probes.map(async (probe: CountProbe): Promise<UsageMetric> => {
      const outcome = await this.probeCount(probe);
      const attempt = outcome.attempt;
      const status: UsageMetric['status'] = attempt
        ? 'ok'
        : outcome.unauthorized
          ? 'unauthorized'
          : 'unavailable';
      const metric: UsageMetric = {
        key: probe.key,
        label: probe.label,
        detail: probe.detail,
        value: attempt ? attempt.value : null,
        source: attempt?.request.path ?? (outcome.unauthorized ? 'Unauthorized (401/403)' : 'No count field returned'),
        status,
      };
      accumulated.push(metric);
      onPartialUpdate?.([...accumulated]);
      return metric;
    });

    // Run work-item-type metrics concurrently with the base probes
    const workItemTypePromise = this.loadWorkItemTypeMetrics().then(witmMetrics => {
      accumulated.push(...witmMetrics);
      onPartialUpdate?.([...accumulated]);
      return witmMetrics;
    });

    const [baseMetrics, workItemTypeMetrics] = await Promise.all([
      Promise.all(baseMetricPromises),
      workItemTypePromise,
    ]);

    const metrics = [...baseMetrics, ...workItemTypeMetrics];

    return {
      metrics,
      unavailable: metrics.filter((metric: UsageMetric) => metric.value === null).map((metric) => metric.label),
      refreshedAt,
    };
  }

  private async loadWorkItemTypeMetrics(): Promise<UsageMetric[]> {
    const [typesResult, countResult] = await Promise.all([
      this.fetchWorkItemTypes(),
      this.countWorkItemsByTypeViaPagination(),
    ]);

    const unauthorized = typesResult.unauthorized || countResult.unauthorized;
    const unavailable = countResult.total === null;

    const totalStatus: UsageMetric['status'] = unavailable
      ? (unauthorized ? 'unauthorized' : 'unavailable')
      : 'ok';

    const totalMetric: UsageMetric = {
      key: 'work-items-total',
      label: 'Total Work Items',
      detail: 'Total work items in Test Plans.',
      value: countResult.total,
      source: unavailable
        ? (unauthorized ? 'Unauthorized (401/403)' : 'No count field returned')
        : '/niworkitem/v1/query-workitems (paged)',
      status: totalStatus,
    };

    const typeMap = new Map<string, WorkItemTypeDefinition>();
    for (const type of typesResult.types) {
      typeMap.set(type.type.toLowerCase(), type);
    }
    for (const countedType of countResult.counts.keys()) {
      const key = countedType.toLowerCase();
      if (!typeMap.has(key)) {
        typeMap.set(key, { type: countedType, label: countedType });
      }
    }

    const typeMetrics: UsageMetric[] = Array.from(typeMap.values())
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      .map((typeDef) => {
        const value = countResult.total === null
          ? null
          : this.getCountForType(countResult.counts, typeDef.type, typeDef.label);
        const status: UsageMetric['status'] = value === null
          ? (unauthorized ? 'unauthorized' : 'unavailable')
          : 'ok';

        return {
          key: 'work-item-type:' + this.toMetricKeyFragment(typeDef.type),
          label: typeDef.label,
          detail: 'Work items of type ' + typeDef.label + '.',
          value,
          source: value === null
            ? (unauthorized ? 'Unauthorized (401/403)' : 'No count field returned')
            : '/niworkitem/v1/workitemtypes + /niworkitem/v1/query-workitems',
          status,
        };
      });

    return [totalMetric, ...typeMetrics];
  }

  private async fetchWorkItemTypes(): Promise<WorkItemTypeLookupResult> {
    try {
      const response = await fetch(
        this.context.buildApiUrl('/niworkitem/v1/workitemtypes'),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return {
          types: [],
          unauthorized: response.status === 401 || response.status === 403,
        };
      }

      const payload = (await response.json()) as unknown;
      const types = this.parseWorkItemTypes(payload);
      return {
        types,
        unauthorized: false,
      };
    } catch {
      return {
        types: [],
        unauthorized: false,
      };
    }
  }

  private parseWorkItemTypes(payload: unknown): WorkItemTypeDefinition[] {
    const candidates = this.extractArrayCandidate(payload, ['workItemTypes', 'types', 'value']);
    if (!candidates) {
      return [];
    }

    const result = new Map<string, WorkItemTypeDefinition>();
    for (const entry of candidates) {
      if (typeof entry === 'string') {
        const value = entry.trim();
        if (value.length > 0) {
          result.set(value.toLowerCase(), { type: value, label: value });
        }
        continue;
      }

      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const type =
        this.toNonEmptyString(record['type']) ??
        this.toNonEmptyString(record['id']) ??
        this.toNonEmptyString(record['key']) ??
        this.toNonEmptyString(record['value']) ??
        this.toNonEmptyString(record['name']) ??
        this.toNonEmptyString(record['displayName']);
      if (!type) {
        continue;
      }

      const label =
        this.toNonEmptyString(record['displayName']) ??
        this.toNonEmptyString(record['name']) ??
        type;
      result.set(type.toLowerCase(), {
        type,
        label,
      });
    }

    return Array.from(result.values());
  }

  private async countWorkItemsByTypeViaPagination(): Promise<WorkItemTypeCountResult> {
    const take = 1000;
    let continuationToken: string | undefined;
    let page = 0;
    const maxPages = 500;
    let total = 0;
    const counts = new Map<string, number>();

    while (page < maxPages) {
      const body: Record<string, unknown> = { take };
      if (continuationToken) {
        body['continuationToken'] = continuationToken;
      }

      const response = await fetch(
        this.context.buildApiUrl('/niworkitem/v1/query-workitems'),
        this.context.buildRequestInit({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );

      if (!response.ok) {
        return {
          total: null,
          counts: new Map<string, number>(),
          unauthorized: response.status === 401 || response.status === 403,
        };
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return {
          total: null,
          counts: new Map<string, number>(),
          unauthorized: false,
        };
      }

      const record = payload as Record<string, unknown>;
      const workItems = Array.isArray(record['workItems'])
        ? (record['workItems'] as unknown[])
        : Array.isArray(record['workitems'])
          ? (record['workitems'] as unknown[])
          : [];

      total += workItems.length;
      for (const item of workItems) {
        const type = this.extractWorkItemTypeValue(item);
        if (!type) {
          continue;
        }

        counts.set(type, (counts.get(type) ?? 0) + 1);
      }

      const tokenValue = record['continuationToken'];
      continuationToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;
      page += 1;

      if (!continuationToken) {
        return {
          total,
          counts,
          unauthorized: false,
        };
      }
    }

    return {
      total,
      counts,
      unauthorized: false,
    };
  }

  private extractWorkItemTypeValue(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const record = item as Record<string, unknown>;
    return (
      this.toNonEmptyString(record['type']) ??
      this.toNonEmptyString(record['workItemType']) ??
      this.toNonEmptyString(record['workitemType']) ??
      this.toNonEmptyString(record['itemType'])
    );
  }

  private extractArrayCandidate(payload: unknown, keys: string[]): unknown[] | null {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private toNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toMetricKeyFragment(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown';
  }

  private getCountForType(counts: Map<string, number>, ...aliases: string[]): number {
    for (const alias of aliases) {
      const exact = counts.get(alias);
      if (exact !== undefined) {
        return exact;
      }

      const lowerAlias = alias.toLowerCase();
      for (const [key, value] of counts.entries()) {
        if (key.toLowerCase() === lowerAlias) {
          return value;
        }
      }
    }

    return 0;
  }

  private async probeCount(probe: CountProbe): Promise<ProbeOutcome> {
    if (
      probe.key === 'systems' ||
      probe.key === 'connected-systems' ||
      probe.key === 'disconnected-systems' ||
      probe.key === 'virtual-systems'
    ) {
      const systemsSummary = await this.fetchSystemsSummaryCounts();
      if (systemsSummary) {
        const total =
          (systemsSummary.connected ?? 0) +
          (systemsSummary.disconnected ?? 0) +
          (systemsSummary.virtual ?? 0);

        const valueByKey: Record<string, number | null> = {
          'systems': total,
          'connected-systems': systemsSummary.connected,
          'disconnected-systems': systemsSummary.disconnected,
          'virtual-systems': systemsSummary.virtual,
        };

        const value = valueByKey[probe.key] ?? null;
        if (value !== null) {
          return {
            attempt: {
              request: {
                method: 'GET',
                path: '/nisysmgmt/v1/get-systems-summary',
              },
              value,
            },
            unauthorized: false,
          };
        }

        return {
          attempt: null,
          unauthorized: systemsSummary.unauthorized,
        };
      }
    }

    if (probe.key === 'users') {
      const pagedUserCount = await this.countUsersViaPagination();
      if (pagedUserCount !== null) {
        return {
          attempt: {
            request: {
              method: 'POST',
              path: '/niuser/v1/users/query (paged)',
            },
            value: pagedUserCount,
          },
          unauthorized: false,
        };
      }
    }

    if (probe.key === 'grafana-dashboards') {
      const grafanaCount = await this.countGrafanaDashboardsStrict();
      if (grafanaCount) {
        return {
          attempt: grafanaCount,
          unauthorized: false,
        };
      }
    }

    if (probe.key === 'data-tables') {
      const dataTablesCount = await this.countDataTablesViaPagination();
      if (dataTablesCount !== null) {
        return {
          attempt: {
            request: {
              method: 'GET',
              path: '/nidataframe/v1/tables (paged)',
            },
            value: dataTablesCount,
          },
          unauthorized: false,
        };
      }

      // Avoid generic fallback for Data Tables because deep object scanning can return misleading low values.
      return { attempt: null, unauthorized: false };
    }

    if (probe.key === 'work-flows') {
      const workflowsCount = await this.countWorkflowsViaPagination();
      if (workflowsCount !== null) {
        return {
          attempt: {
            request: {
              method: 'POST',
              path: '/niworkitem|niworkorder/v1/query-workflows (paged)',
            },
            value: workflowsCount,
          },
          unauthorized: false,
        };
      }

      // Avoid generic fallback for Workflows because nested metadata fields often include version=1.
      return { attempt: null, unauthorized: false };
    }

    if (probe.key === 'work-item-templates') {
      const templatesCount = await this.countWorkItemTemplatesViaPagination();
      if (templatesCount !== null) {
        return {
          attempt: {
            request: {
              method: 'POST',
              path: '/niworkitem/v1/query-workitem-templates (paged)',
            },
            value: templatesCount,
          },
          unauthorized: false,
        };
      }

      // Avoid generic fallback for templates because responses contain many scalar fields unrelated to totals.
      return { attempt: null, unauthorized: false };
    }

    if (probe.key === 'package-counts') {
      const packageCounts = await this.countPackagesAcrossFeeds();
      if (packageCounts.total !== null) {
        return {
          attempt: {
            request: {
              method: 'GET',
              path: '/nifeed/v1/feeds/{feedId}/packages',
            },
            value: packageCounts.total,
          },
          unauthorized: false,
        };
      }

      // Avoid generic fallback for package counts because feed responses contain unrelated scalar values.
      return { attempt: null, unauthorized: packageCounts.unauthorized };
    }

    if (
      probe.key === 'enabled-routines' ||
      probe.key === 'disabled-routines' ||
      probe.key === 'alarm-routines'
    ) {
      const routineStatusCounts = await this.getRoutineStatusCounts();
      if (routineStatusCounts) {
        const value = probe.key === 'enabled-routines'
          ? routineStatusCounts.enabled
          : probe.key === 'disabled-routines'
            ? routineStatusCounts.disabled
            : routineStatusCounts.alarms;

        if (value !== null) {
          return {
            attempt: {
              request: {
                method: 'GET',
                path: '/niroutine/v2/routines (status split)',
              },
              value,
            },
            unauthorized: false,
          };
        }

        return {
          attempt: null,
          unauthorized: routineStatusCounts.unauthorized,
        };
      }

      return { attempt: null, unauthorized: false };
    }

    let sawUnauthorized = false;

    for (const request of probe.requests) {
      const result = await this.tryRequest(request, probe.parser ?? this.extractCount);
      sawUnauthorized = sawUnauthorized || result.unauthorized;
      if (result.value !== null) {
        return {
          attempt: {
            request,
            value: result.value,
          },
          unauthorized: false,
        };
      }
    }

    return { attempt: null, unauthorized: sawUnauthorized };
  }

  private async fetchSystemsSummaryCounts(): Promise<SystemsSummaryCounts | null> {
    try {
      const response = await fetch(
        this.context.buildApiUrl('/nisysmgmt/v1/get-systems-summary'),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return {
          connected: null,
          disconnected: null,
          virtual: null,
          unauthorized: response.status === 401 || response.status === 403,
        };
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const record = payload as Record<string, unknown>;
      const connected = this.toNumber(record['connectedCount']) ?? this.toNumber(record['ConnectedCount']);
      const disconnected =
        this.toNumber(record['disconnectedCount']) ?? this.toNumber(record['DisconnectedCount']);
      const virtual = this.toNumber(record['virtualCount']) ?? this.toNumber(record['VirtualCount']);

      return {
        connected,
        disconnected,
        virtual,
        unauthorized: false,
      };
    } catch {
      return null;
    }
  }

  private async tryRequest(request: CountRequest, parser: CountParser): Promise<RequestAttemptResult> {
    try {
      const init = this.context.buildRequestInit({ method: request.method });
      const headers = new Headers(init.headers ?? {});

      if (request.method === 'POST') {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(
        this.context.buildApiUrl(request.path),
        {
          ...init,
          headers,
          body: request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined,
        },
      );

      if (!response.ok) {
        return {
          value: null,
          unauthorized: response.status === 401 || response.status === 403,
        };
      }

      const headerCount = this.parseCountFromHeaders(response.headers);
      if (headerCount !== null) {
        return { value: headerCount, unauthorized: false };
      }

      const raw = await response.text();
      if (!raw) {
        return { value: null, unauthorized: false };
      }

      const fromText = this.extractCountFromRawText(raw);
      if (fromText !== null) {
        return { value: fromText, unauthorized: false };
      }

      try {
        const payload = JSON.parse(raw) as unknown;
        const parsed = parser(payload);
        if (parsed !== null) {
          return { value: parsed, unauthorized: false };
        }
        return { value: this.findCountDeep(payload, 0, 8), unauthorized: false };
      } catch {
        return { value: null, unauthorized: false };
      }
    } catch {
      return { value: null, unauthorized: false };
    }
  }

  private parseCountFromHeaders(headers: Headers): number | null {
    const raw =
      headers.get('x-total-count') ??
      headers.get('x-ni-total-count') ??
      headers.get('x-total-results') ??
      headers.get('x-count');
    if (!raw) {
      return null;
    }

    return this.toNumber(raw);
  }

  private extractCount(payload: unknown): number | null {
    if (typeof payload === 'number' && Number.isFinite(payload)) {
      return payload;
    }

    if (typeof payload === 'string') {
      const fromText = this.extractCountFromRawText(payload);
      if (fromText !== null) {
        return fromText;
      }

      try {
        const parsed = JSON.parse(payload) as unknown;
        return this.extractCount(parsed);
      } catch {
        return null;
      }
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const entity = payload as Record<string, unknown>;
    const direct = this.getCountFromRecord(entity);
    if (direct !== null) {
      return direct;
    }

    const nestedKeys = ['summary', 'Summary', 'pagination', 'paging', 'metadata', 'meta', 'page'];
    for (const nestedKey of nestedKeys) {
      const nested = entity[nestedKey];
      if (nested && typeof nested === 'object') {
        const nestedCount = this.extractCount(nested);
        if (nestedCount !== null) {
          return nestedCount;
        }
      }
    }

    const deepCount = this.findCountDeep(payload, 0, 6);
    if (deepCount !== null) {
      return deepCount;
    }

    return null;
  }

  private extractStepCount(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const entity = payload as Record<string, unknown>;
    const knownStepKeys = ['totalSteps', 'stepCount', 'stepsCount', 'numberOfSteps'];
    for (const key of knownStepKeys) {
      const raw = entity[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }
    }

    const summary = entity['summary'];
    if (summary && typeof summary === 'object') {
      return this.extractStepCount(summary);
    }

    return this.extractCount(payload);
  }

  private getCountFromRecord(entity: Record<string, unknown>): number | null {
    const knownCountKeys = [
      'totalCount',
      'TotalCount',
      'total',
      'Total',
      'count',
      'Count',
      '@odata.count',
      'valueCount',
      'ValueCount',
      'itemCount',
      'ItemCount',
      'numberOfItems',
      'NumberOfItems',
      'totalItems',
      'TotalItems',
      'totalResults',
      'TotalResults',
      'numberOfResults',
      'NumberOfResults',
      'resultCount',
      'ResultCount',
      'totalUsers',
      'TotalUsers',
      'totalRecords',
      'TotalRecords',
      'recordsTotal',
      'RecordsTotal',
      'definedCount',
      'scheduledCount',
      'inProgressCount',
      'pendingApprovalCount',
      'pastDueDateCount',
    ];

    for (const key of knownCountKeys) {
      const raw = entity[key];
      if (raw && typeof raw === 'object') {
        const value = this.toNumber((raw as Record<string, unknown>)['value']);
        if (value !== null) {
          return value;
        }
      }

      const parsed = this.toNumber(raw);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  private extractArrayCount(payload: unknown): number | null {
    if (Array.isArray(payload)) {
      return payload.length;
    }

    return this.extractCount(payload);
  }

  private extractCollectionCount(payload: unknown, keys: string[]): number | null {
    const direct = this.extractCount(payload);
    if (direct !== null) {
      return direct;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const entity = payload as Record<string, unknown>;
    for (const key of keys) {
      const candidate = entity[key];
      if (Array.isArray(candidate)) {
        return candidate.length;
      }
    }

    return null;
  }

  private extractSystemsCount(payload: unknown): number | null {
    const direct = this.extractCount(payload);
    if (direct !== null) {
      return direct;
    }

    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0];
      if (first && typeof first === 'object') {
        const maybeCount = this.toNumber((first as Record<string, unknown>)['count']);
        if (maybeCount !== null) {
          return maybeCount;
        }
      }
    }

    return null;
  }

  private extractSystemsSummaryTotal(payload: unknown): number | null {
    const explicitTotal = this.findFirstNumericKeyDeep(payload, [
      'totalCount',
      'TotalCount',
      'systemCount',
      'SystemCount',
      'totalSystems',
      'TotalSystems',
    ]);
    if (explicitTotal > 0) {
      return explicitTotal;
    }

    const connected = this.findFirstNumericKeyDeep(payload, ['connectedCount', 'ConnectedCount']);
    const disconnected = this.findFirstNumericKeyDeep(payload, [
      'disconnectedCount',
      'DisconnectedCount',
    ]);
    const virtual = this.findFirstNumericKeyDeep(payload, ['virtualCount', 'VirtualCount']);
    const summed = connected + disconnected + virtual;
    if (summed > 0) {
      return summed;
    }

    return this.extractSystemsCount(payload);
  }

  private extractSystemsSummaryConnected(payload: unknown): number | null {
    const connected = this.findFirstNumericKeyDeep(payload, ['connectedCount', 'ConnectedCount']);
    return connected > 0 ? connected : this.toNumber(connected);
  }

  private extractSystemsSummaryDisconnected(payload: unknown): number | null {
    const disconnected = this.findFirstNumericKeyDeep(payload, ['disconnectedCount', 'DisconnectedCount']);
    return disconnected > 0 ? disconnected : this.toNumber(disconnected);
  }

  private extractSystemsSummaryVirtual(payload: unknown): number | null {
    const virtual = this.findFirstNumericKeyDeep(payload, ['virtualCount', 'VirtualCount']);
    return virtual > 0 ? virtual : this.toNumber(virtual);
  }

  private extractWorkItemsCount(payload: unknown): number | null {
    const direct = this.extractCount(payload);
    if (direct !== null) {
      return direct;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const keys = [
      'definedCount',
      'scheduledCount',
      'inProgressCount',
      'pendingApprovalCount',
    ];

    let sum = 0;
    let hasAny = false;
    for (const key of keys) {
      const value = this.toNumber(record[key]);
      if (value !== null) {
        sum += value;
        hasAny = true;
      }
    }

    return hasAny ? sum : null;
  }

  private async countUsersViaPagination(): Promise<number | null> {
    let continuationToken: string | undefined;
    let total = 0;
    let page = 0;
    const maxPages = 200;

    while (page < maxPages) {
      const body: Record<string, unknown> = {
        take: 1000,
      };
      if (continuationToken) {
        body['continuationToken'] = continuationToken;
      }

      const response = await fetch(
        this.context.buildApiUrl('/niuser/v1/users/query'),
        this.context.buildRequestInit({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const record = payload as Record<string, unknown>;
      const users = Array.isArray(record['users']) ? record['users'] : [];
      total += users.length;

      const tokenValue = record['continuationToken'];
      continuationToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;
      page += 1;

      if (!continuationToken) {
        return total;
      }
    }

    return total > 0 ? total : null;
  }

  private async countSystemsViaPagination(filter?: string): Promise<number | null> {
    const take = 1000;
    let skip = 0;
    let total = 0;
    let page = 0;
    const maxPages = 500;

    while (page < maxPages) {
      const body: Record<string, unknown> = {
        take,
        skip,
      };

      if (filter && filter.length > 0) {
        body['filter'] = filter;
      }

      const response = await fetch(
        this.context.buildApiUrl('/nisysmgmt/v1/query-systems'),
        this.context.buildRequestInit({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        const fallback = this.extractSystemsCount(payload);
        return fallback;
      }

      const pageCount = payload.length;
      total += pageCount;
      page += 1;

      if (pageCount < take) {
        return total;
      }

      skip += take;
    }

    return total > 0 ? total : null;
  }

  private async countSystemsViaGetSystems(): Promise<number | null> {
    const response = await fetch(
      this.context.buildApiUrl('/nisysmgmt/v1/systems'),
      this.context.buildRequestInit({ method: 'GET' }),
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return null;
    }

    return payload.length;
  }

  private async countDataTablesViaPagination(): Promise<number | null> {
    const byQuery = await this.countDataFrameTablesViaGetTables();
    const byPostQuery = await this.countDataFrameTablesViaQueryTables();

    if (byQuery === null && byPostQuery === null) {
      return null;
    }

    return Math.max(byQuery ?? 0, byPostQuery ?? 0);
  }

  private async countDataFrameTablesViaGetTables(): Promise<number | null> {
    const take = 1000;
    let continuationToken: string | undefined;
    let total = 0;
    let page = 0;
    const maxPages = 500;

    while (page < maxPages) {
      const params = new URLSearchParams();
      params.set('take', String(take));
      if (continuationToken) {
        params.set('continuationToken', continuationToken);
      }

      const response = await fetch(
        this.context.buildApiUrl('/nidataframe/v1/tables?' + params.toString()),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const record = payload as Record<string, unknown>;
      const tables = Array.isArray(record['tables']) ? record['tables'] : [];
      total += tables.length;

      const tokenValue = record['continuationToken'];
      continuationToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;
      page += 1;

      if (!continuationToken) {
        return total;
      }
    }

    return total > 0 ? total : null;
  }

  private async countDataFrameTablesViaQueryTables(): Promise<number | null> {
    const take = 1000;
    let continuationToken: string | undefined;
    let total = 0;
    let page = 0;
    const maxPages = 500;

    while (page < maxPages) {
      const body: Record<string, unknown> = {
        take,
      };
      if (continuationToken) {
        body['continuationToken'] = continuationToken;
      }

      const response = await fetch(
        this.context.buildApiUrl('/nidataframe/v1/query-tables'),
        this.context.buildRequestInit({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const record = payload as Record<string, unknown>;
      const tables = Array.isArray(record['tables']) ? record['tables'] : [];
      total += tables.length;

      const tokenValue = record['continuationToken'];
      continuationToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;
      page += 1;

      if (!continuationToken) {
        return total;
      }
    }

    return total > 0 ? total : null;
  }

  private async countWorkflowsViaPagination(): Promise<number | null> {
    const workItemTotal = await this.countWorkItemWorkflowsViaPagination();
    const workOrderTotal = await this.countWorkOrderWorkflowsViaPagination();

    if (workItemTotal === null && workOrderTotal === null) {
      return null;
    }

    return (workItemTotal ?? 0) + (workOrderTotal ?? 0);
  }

  private async countWorkItemWorkflowsViaPagination(): Promise<number | null> {
    return this.countPagedCollectionByContinuationToken({
      path: '/niworkitem/v1/query-workflows',
      collectionKey: 'workflows',
    });
  }

  private async countWorkOrderWorkflowsViaPagination(): Promise<number | null> {
    return this.countPagedCollectionByContinuationToken({
      path: '/niworkorder/v1/query-workflows',
      collectionKey: 'workflows',
    });
  }

  private async countWorkItemTemplatesViaPagination(): Promise<number | null> {
    return this.countPagedCollectionByContinuationToken({
      path: '/niworkitem/v1/query-workitem-templates',
      collectionKey: 'workItemTemplates',
    });
  }

  private async countPackagesAcrossFeeds(): Promise<FeedPackageCountResult> {
    const feedsResponse = await fetch(
      this.context.buildApiUrl('/nifeed/v1/feeds'),
      this.context.buildRequestInit({ method: 'GET' }),
    );

    if (!feedsResponse.ok) {
      return {
        total: null,
        unauthorized: feedsResponse.status === 401 || feedsResponse.status === 403,
      };
    }

    const feedsPayload = (await feedsResponse.json()) as unknown;
    const feedIds = this.extractFeedIds(feedsPayload);
    if (feedIds.length === 0) {
      return {
        total: 0,
        unauthorized: false,
      };
    }

    // Smaller batch size + inter-batch delay to stay under the 429 rate limit
    const BATCH_SIZE = 5;
    let total = 0;

    for (let i = 0; i < feedIds.length; i += BATCH_SIZE) {
      if (i > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 200));
      }
      const batch = feedIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(feedId => this.fetchPackageCountForFeed(feedId)));
      for (const count of batchResults) {
        if (count === null) {
          continue;
        }
        total += count;
      }
    }

    return { total, unauthorized: false };
  }

  private async fetchPackageCountForFeed(feedId: string): Promise<number | null> {
    const url = this.context.buildApiUrl('/nifeed/v1/feeds/' + encodeURIComponent(feedId) + '/packages');
    const init = this.context.buildRequestInit({ method: 'GET' });

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, init);

        if (response.status === 429) {
          await new Promise<void>(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }

        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as unknown;
        const arr = this.extractArrayCandidate(payload, ['packages', 'value', 'items']);
        if (arr) return arr.length;
        return this.extractCollectionCount(payload, ['packages', 'value', 'items']) ?? 0;
      } catch {
        return null;
      }
    }

    return null;
  }

  private async getRoutineStatusCounts(): Promise<RoutineStatusCounts | null> {
    if (!this.routineStatusCountsPromise) {
      this.routineStatusCountsPromise = this.countRoutineStatusesStrict();
    }

    return this.routineStatusCountsPromise;
  }

  private async countRoutineStatusesStrict(): Promise<RoutineStatusCounts | null> {
    const fromV1 = await this.countRoutineStatusesByScanningRoutines('/niroutine/v1/routines');
    const fromV2 = await this.countRoutineStatusesByScanningRoutines('/niroutine/v2/routines');

    const enabled =
      fromV1?.enabled !== null && fromV1?.enabled !== undefined &&
      fromV2?.enabled !== null && fromV2?.enabled !== undefined
        ? fromV1.enabled + fromV2.enabled
        : fromV1?.enabled ?? fromV2?.enabled ?? null;

    const disabled =
      fromV1?.disabled !== null && fromV1?.disabled !== undefined &&
      fromV2?.disabled !== null && fromV2?.disabled !== undefined
        ? fromV1.disabled + fromV2.disabled
        : fromV1?.disabled ?? fromV2?.disabled ?? null;

    const alarms =
      fromV2?.alarms !== null && fromV2?.alarms !== undefined
        ? fromV2.alarms
        : fromV1?.alarms ?? null;

    const hasAnyCount = enabled !== null || disabled !== null || alarms !== null;
    if (!hasAnyCount) {
      const unauthorized = Boolean(fromV1?.unauthorized || fromV2?.unauthorized);
      if (unauthorized) {
        return {
          enabled: null,
          disabled: null,
          alarms: null,
          unauthorized: true,
        };
      }

      return null;
    }

    return {
      enabled,
      disabled,
      alarms,
      unauthorized: false,
    };
  }

  private async countRoutineStatusesByScanningRoutines(basePath: string): Promise<RoutineStatusCounts | null> {
    const take = 1000;
    let continuationToken: string | undefined;
    let skip = 0;
    let page = 0;
    const maxPages = 500;
    let enabled = 0;
    let disabled = 0;
    let alarms = 0;
    let sawAny = false;
    let sawEnabledSignal = false;
    let sawAlarmSignal = false;
    const seenRoutineKeys = new Set<string>();

    while (page < maxPages) {
      const params = new URLSearchParams();
      params.set('take', String(take));
      params.set('skip', String(skip));
      if (continuationToken) {
        params.set('continuationToken', continuationToken);
      }

      const response = await fetch(
        this.context.buildApiUrl(basePath + '?' + params.toString()),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return {
          enabled: null,
          disabled: null,
          alarms: null,
          unauthorized: response.status === 401 || response.status === 403,
        };
      }

      const payload = (await response.json()) as unknown;
      const routines = this.extractArrayCandidate(payload, ['routines', 'value', 'items'])
        ?? (Array.isArray(payload) ? payload : null);
      if (!routines) {
        return null;
      }

      let newItemsOnPage = 0;
      for (const routine of routines) {
        const routineKey = this.getRoutineUniqueKey(routine);
        if (routineKey && seenRoutineKeys.has(routineKey)) {
          continue;
        }
        if (routineKey) {
          seenRoutineKeys.add(routineKey);
        }
        newItemsOnPage += 1;

        const isEnabled = this.extractRoutineEnabled(routine);
        if (isEnabled !== null) {
          sawAny = true;
          sawEnabledSignal = true;
          if (isEnabled) {
            enabled += 1;
          } else {
            disabled += 1;
          }
        }

        const hasAlarmAction = this.extractRoutineHasAlarmAction(routine);
        if (hasAlarmAction !== null) {
          sawAny = true;
          sawAlarmSignal = true;
          if (hasAlarmAction) {
            alarms += 1;
          }
        }
      }

      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
      const tokenValue = record?.['continuationToken'];
      const nextToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;

      page += 1;
      if (nextToken) {
        continuationToken = nextToken;
        continue;
      }

      if (newItemsOnPage === 0) {
        break;
      }

      continuationToken = undefined;
      skip += Math.max(routines.length, 1);

      if (routines.length < take) {
        // Endpoint can still page via skip even when returned size is below requested take.
        // Continue until no new routines are discovered.
        continue;
      }
    }

    if (!sawEnabledSignal) {
      const enabledStrict = await this.countRoutinesFromQueryStrict(basePath, ['enabled=true', 'filter=enabled eq true']);
      const disabledStrict = await this.countRoutinesFromQueryStrict(basePath, ['enabled=false', 'filter=enabled eq false']);
      if (enabledStrict !== null && disabledStrict !== null) {
        enabled = enabledStrict;
        disabled = disabledStrict;
        sawAny = true;
      }
    }

    if (!sawAlarmSignal) {
      const alarmsStrict = await this.countRoutinesFromQueryStrict(basePath, ['actionType=ALARM', 'filter=actionType eq ALARM']);
      if (alarmsStrict !== null) {
        alarms = alarmsStrict;
        sawAny = true;
      }
    }

    if (!sawAny) {
      return null;
    }

    return {
      enabled,
      disabled,
      alarms,
      unauthorized: false,
    };
  }

  private getRoutineUniqueKey(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    return (
      this.toNonEmptyString(record['id']) ??
      this.toNonEmptyString(record['routineId']) ??
      this.toNonEmptyString(record['name']) ??
      this.toNonEmptyString(record['displayName'])
    );
  }

  private extractRoutineEnabled(value: unknown): boolean | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const directBoolean = [
      record['enabled'],
      record['isEnabled'],
      record['Enabled'],
      record['IsEnabled'],
    ];

    for (const candidate of directBoolean) {
      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'enabled') {
          return true;
        }
        if (normalized === 'false' || normalized === 'disabled') {
          return false;
        }
      }
    }

    const stateLike = [
      record['state'],
      record['status'],
      record['routineState'],
      record['executionState'],
    ];

    for (const candidate of stateLike) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const normalized = candidate.trim().toLowerCase();
      if (normalized.includes('enabled') || normalized === 'active') {
        return true;
      }
      if (normalized.includes('disabled') || normalized === 'inactive') {
        return false;
      }
    }

    return null;
  }

  private extractRoutineHasAlarmAction(value: unknown): boolean | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;

    const flatActionHints = [
      record['actionType'],
      record['ActionType'],
      record['type'],
      record['Type'],
    ];
    for (const candidate of flatActionHints) {
      if (typeof candidate !== 'string') {
        continue;
      }
      if (candidate.trim().toUpperCase() === 'ALARM') {
        return true;
      }
    }

    const actionCollections = [
      record['actions'],
      record['Actions'],
      record['actionList'],
      record['ActionList'],
      record['routineActions'],
      record['RoutineActions'],
    ];

    let sawAction = false;
    for (const collection of actionCollections) {
      if (!Array.isArray(collection)) {
        continue;
      }

      for (const item of collection) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        sawAction = true;
        const action = item as Record<string, unknown>;
        const type =
          this.toNonEmptyString(action['actionType']) ??
          this.toNonEmptyString(action['type']) ??
          this.toNonEmptyString(action['name']) ??
          this.toNonEmptyString(action['kind']);
        if (type && type.toUpperCase() === 'ALARM') {
          return true;
        }
      }
    }

    if (sawAction) {
      return false;
    }

    return null;
  }

  private async countRoutinesFromQueryStrict(basePath: string, queryCandidates: readonly string[]): Promise<number | null> {
    for (const query of queryCandidates) {
      const result = await this.countRoutinesFromSingleQueryStrict(basePath, query);
      if (result !== null) {
        return result;
      }
    }

    return null;
  }

  private async countRoutinesFromSingleQueryStrict(basePath: string, query: string): Promise<number | null> {
    const take = 1000;
    let continuationToken: string | undefined;
    let skip = 0;
    let total = 0;
    let page = 0;
    const maxPages = 500;
    const seenRoutineKeys = new Set<string>();

    while (page < maxPages) {
      const params = new URLSearchParams();
      params.set('take', String(take));
      params.set('skip', String(skip));

      const [queryKey, ...queryValueParts] = query.split('=');
      if (queryKey && queryValueParts.length > 0) {
        params.set(queryKey, queryValueParts.join('='));
      }

      if (continuationToken) {
        params.set('continuationToken', continuationToken);
      }

      const response = await fetch(
        this.context.buildApiUrl(basePath + '?' + params.toString()),
        this.context.buildRequestInit({ method: 'GET' }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      const routines = this.extractArrayCandidate(payload, ['routines', 'value', 'items'])
        ?? (Array.isArray(payload) ? payload : null);
      if (!routines) {
        return null;
      }

      let newItemsOnPage = 0;
      for (const routine of routines) {
        const routineKey = this.getRoutineUniqueKey(routine);
        if (routineKey && seenRoutineKeys.has(routineKey)) {
          continue;
        }
        if (routineKey) {
          seenRoutineKeys.add(routineKey);
        }
        newItemsOnPage += 1;
      }
      total += newItemsOnPage;

      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
      const tokenValue = record?.['continuationToken'];
      const nextToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;

      page += 1;
      if (nextToken) {
        continuationToken = nextToken;
        continue;
      }

      if (newItemsOnPage === 0) {
        return total;
      }

      continuationToken = undefined;
      skip += Math.max(routines.length, 1);
    }

    return total;
  }

  private extractFeedIds(payload: unknown): string[] {
    const feeds = this.extractArrayCandidate(payload, ['feeds', 'value', 'items']);
    if (!feeds) {
      return [];
    }

    const ids = new Set<string>();
    for (const entry of feeds) {
      if (typeof entry === 'string') {
        const feedId = entry.trim();
        if (feedId.length > 0) {
          ids.add(feedId);
        }
        continue;
      }

      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const feedId =
        this.toNonEmptyString(record['feedId']) ??
        this.toNonEmptyString(record['id']) ??
        this.toNonEmptyString(record['name']);

      if (feedId) {
        ids.add(feedId);
      }
    }

    return Array.from(ids.values());
  }

  private async countPagedCollectionByContinuationToken(options: {
    path: string;
    collectionKey: string;
  }): Promise<number | null> {
    const take = 1000;
    let continuationToken: string | undefined;
    let total = 0;
    let page = 0;
    const maxPages = 500;

    while (page < maxPages) {
      const body: Record<string, unknown> = {
        take,
      };
      if (continuationToken) {
        body['continuationToken'] = continuationToken;
      }

      const response = await fetch(
        this.context.buildApiUrl(options.path),
        this.context.buildRequestInit({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const record = payload as Record<string, unknown>;
      const items = Array.isArray(record[options.collectionKey])
        ? (record[options.collectionKey] as unknown[])
        : [];
      total += items.length;

      const tokenValue = record['continuationToken'];
      continuationToken = typeof tokenValue === 'string' && tokenValue.length > 0 ? tokenValue : undefined;
      page += 1;

      if (!continuationToken) {
        return total;
      }
    }

    return total > 0 ? total : null;
  }

  private async countGrafanaDashboardsStrict(): Promise<CountAttempt | null> {
    const bootstrapPaths = [
      '/dashboardhost/login',
    ];

    for (const path of bootstrapPaths) {
      try {
        await fetch(
          this.context.buildApiUrl(path),
          this.context.buildRequestInit({ method: 'GET' }),
        );
      } catch {
        // Continue with remaining bootstrap calls.
      }
    }

    const queryPaths = [
      '/dashboardhost/api/search?type=dash-db&query=&limit=5000',
      '/dashboardhost/api/search?type=dash-db&limit=5000',
      '/dashboardhost/api/search?type=dash-db',
      '/grafana/api/search?type=dash-db&query=&limit=5000',
      '/grafana/api/search?type=dash-db&limit=5000',
      '/grafana/api/search?type=dash-db',
    ];

    for (const path of queryPaths) {
      try {
        const response = await fetch(
          this.context.buildApiUrl(path),
          this.context.buildRequestInit({ method: 'GET' }),
        );

        if (!response.ok) {
          continue;
        }

        const raw = await response.text();
        if (!raw) {
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          continue;
        }

        if (Array.isArray(payload)) {
          return {
            request: { method: 'GET', path },
            value: payload.length,
          };
        }

        if (payload && typeof payload === 'object') {
          const record = payload as Record<string, unknown>;
          const dashboards = record['dashboards'];
          if (Array.isArray(dashboards)) {
            return {
              request: { method: 'GET', path },
              value: dashboards.length,
            };
          }

          const results = record['results'];
          if (Array.isArray(results)) {
            return {
              request: { method: 'GET', path },
              value: results.length,
            };
          }

          const totalCount = this.toNumber(record['totalCount']) ?? this.toNumber(record['TotalCount']);
          if (totalCount !== null) {
            return {
              request: { method: 'GET', path },
              value: totalCount,
            };
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private extractCountFromRawText(raw: string): number | null {
    const patterns = [
      /["']?totalCount["']?\s*:\s*(\d+)/i,
      /["']?TotalCount["']?\s*:\s*(\d+)/i,
      /["']?count["']?\s*:\s*(\d+)/i,
      /["']?Count["']?\s*:\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match || match.length < 2) {
        continue;
      }

      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  private findCountDeep(value: unknown, depth: number, maxDepth: number): number | null {
    if (depth > maxDepth || value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return null;
    }

    if (typeof value === 'string') {
      return this.extractCountFromRawText(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findCountDeep(item, depth + 1, maxDepth);
        if (found !== null) {
          return found;
        }
      }

      return null;
    }

    if (typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const direct = this.getCountFromRecord(record);
    if (direct !== null) {
      return direct;
    }

    for (const nestedValue of Object.values(record)) {
      const found = this.findCountDeep(nestedValue, depth + 1, maxDepth);
      if (found !== null) {
        return found;
      }
    }

    return null;
  }

  private findFirstNumericKeyDeep(
    value: unknown,
    keys: string[],
    depth = 0,
    maxDepth = 8,
  ): number {
    if (depth > maxDepth || value === null || value === undefined) {
      return 0;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findFirstNumericKeyDeep(item, keys, depth + 1, maxDepth);
        if (found > 0) {
          return found;
        }
      }

      return 0;
    }

    if (typeof value !== 'object') {
      return 0;
    }

    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const parsed = this.toNumber(record[key]);
      if (parsed !== null && parsed >= 0) {
        return parsed;
      }
    }

    for (const nested of Object.values(record)) {
      const found = this.findFirstNumericKeyDeep(nested, keys, depth + 1, maxDepth);
      if (found > 0) {
        return found;
      }
    }

    return 0;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }
}