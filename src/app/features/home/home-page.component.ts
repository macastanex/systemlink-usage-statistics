import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';

import '@ni/nimble-components/dist/esm/icons/check';
import '@ni/nimble-components/dist/esm/icons/download';
import '@ni/nimble-components/dist/esm/icons/lock';
import '@ni/nimble-components/dist/esm/icons/magnifying-glass';
import '@ni/nimble-components/dist/esm/dialog';
import '@ni/nimble-components/dist/esm/table';
import '@ni/nimble-components/dist/esm/table-column/text';
import '@ni/nimble-components/dist/esm/icons/xmark';

import { AppViewStateService } from '../../core/state/app-view-state.service';
import { CurrentUserService } from '../../core/systemlink/current-user.service';
import { TagHistoryEntry, TagStatisticsService } from '../../core/systemlink/tag-statistics.service';
import {
  UsageDashboardModel,
  UsageMetric,
  UsageMetricsService,
} from '../../core/systemlink/usage-metrics.service';
import { ViewState } from '../../shared/states/view-state.model';

interface NimbleDialogElement extends HTMLElement {
  show: () => Promise<void>;
  close: (reason?: unknown) => void;
}

interface NimbleTableElement extends HTMLElement {
  setData: (rows: readonly unknown[]) => Promise<void>;
}

interface StatsTableRow {
  id: string;
  timestamp: string;
  value: string;
}

type UsageStatusGlyph = 'pass' | 'fail' | 'lock' | 'none' | 'pending';

interface UsageTreeNode {
  id: string;
  metric: string;
  count: string;
  details: string;
  source: string;
  statusGlyph: UsageStatusGlyph;
  statusLabel: string;
  children: readonly UsageTreeNode[];
}

interface UsageTreeLeaf {
  key: string;
  label: string;
  fallbackDetail: string;
}

interface UsageTreeGroup {
  key: string;
  label: string;
  description: string;
  children: readonly UsageTreeLeaf[];
}

@Component({
  selector: 'sl-home-page',
  standalone: false,
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit {
  private static readonly GROUPS: readonly UsageTreeGroup[] = [
    {
      key: 'assets-systems',
      label: 'Assets & Systems Management',
      description: 'Asset and system inventory metrics.',
      children: [
        {
          key: 'assets',
          label: 'Assets',
          fallbackDetail: 'Total assets tracked by Asset Performance Management.',
        },
        {
          key: 'systems',
          label: 'Total Systems',
          fallbackDetail: 'Total systems from Systems Management summary.',
        },
        {
          key: 'connected-systems',
          label: 'Connected Systems',
          fallbackDetail: 'Connected systems from Systems Management summary.',
        },
        {
          key: 'disconnected-systems',
          label: 'Disconnected Systems',
          fallbackDetail: 'Disconnected systems from Systems Management summary.',
        },
        {
          key: 'virtual-systems',
          label: 'Virtual Systems',
          fallbackDetail: 'Virtual systems from Systems Management summary.',
        },
      ],
    },
    {
      key: 'configuration-management',
      label: 'Configuration Management',
      description: 'State, feed, and package-management metrics.',
      children: [
        {
          key: 'states',
          label: 'States',
          fallbackDetail: 'Total software states.',
        },
        {
          key: 'feeds',
          label: 'Feeds',
          fallbackDetail: 'Total package feeds.',
        },
        {
          key: 'package-counts',
          label: 'Package Counts',
          fallbackDetail: 'Total packages available through package feeds.',
        },
      ],
    },
    {
      key: 'data-management',
      label: 'Data Management',
      description: 'Test and file data footprint metrics.',
      children: [
        {
          key: 'products',
          label: 'Products',
          fallbackDetail: 'Total test products in Test Monitor.',
        },
        {
          key: 'test-results',
          label: 'Results',
          fallbackDetail: 'Total test results available to the current user.',
        },
        {
          key: 'test-steps',
          label: 'Steps',
          fallbackDetail: 'Total reported test steps.',
        },
        {
          key: 'data-tables',
          label: 'Data Tables',
          fallbackDetail: 'Total configured data tables.',
        },
        {
          key: 'files',
          label: 'Files',
          fallbackDetail: 'Total files in File Service.',
        },
      ],
    },
    {
      key: 'user-management',
      label: 'User Management',
      description: 'Identity and workspace metrics.',
      children: [
        {
          key: 'users',
          label: 'Users',
          fallbackDetail: 'Total users available from User Management.',
        },
        {
          key: 'workspaces',
          label: 'Workspaces',
          fallbackDetail: 'Total workspaces configured on the instance.',
        },
        {
          key: 'roles',
          label: 'Roles',
          fallbackDetail: 'Total role templates in Authorization service.',
        },
      ],
    },
    {
      key: 'scheduling',
      label: 'Operations and Scheduling',
      description: 'Planning and execution metrics.',
      children: [
        {
          key: 'work-items-total',
          label: 'Work Items',
          fallbackDetail: 'Total work items in Test Plans.',
        },
        {
          key: 'work-item-types-dynamic',
          label: 'Work Item Types',
          fallbackDetail: 'Counts for each work item type.',
        },
        {
          key: 'work-flows',
          label: 'Workflows',
          fallbackDetail: 'Total workflow definitions.',
        },
        {
          key: 'work-item-templates',
          label: 'Work Item Templates',
          fallbackDetail: 'Total work item templates.',
        },
      ],
    },
    {
      key: 'analytics-visualizations',
      label: 'Analytics and Visualizations',
      description: 'Dashboard and routine metrics.',
      children: [
        {
          key: 'grafana-dashboards',
          label: 'Dashboards',
          fallbackDetail: 'Total dashboards discoverable through embedded Grafana.',
        },
        {
          key: 'enabled-routines',
          label: 'Enabled Routines',
          fallbackDetail: 'Total enabled event-action routines.',
        },
        {
          key: 'disabled-routines',
          label: 'Disabled Routines',
          fallbackDetail: 'Total disabled event-action routines.',
        },
        {
          key: 'alarm-routines',
          label: 'Alarms',
          fallbackDetail: 'Routines whose action list includes ALARM.',
        },
      ],
    },
  ];

  state: ViewState<UsageDashboardModel>;
  searchTerm = '';
  private allTreeNodes: readonly UsageTreeNode[] = [];
  treeNodes: readonly UsageTreeNode[] = [];
  isSuperUser = false;
  selectedMetricNode: UsageTreeNode | null = null;
  statisticsLoading = false;
  statisticsHistory: readonly TagHistoryEntry[] = [];
  statisticsMetricLabel = '';
  statisticsMetricKey = '';
  dailyRates = new Map<string, number | null>();
  dailyRatesLoading = false;
  isPartialLoad = false;
  private lwChart: null = null; // reserved
  private rateQueue: UsageMetric[] = [];
  private rateQueuedKeys = new Set<string>();
  private rateWorkerActive = false;

  @ViewChild('statsDialog') private statsDialog?: ElementRef<NimbleDialogElement>;
  @ViewChild('statsTable') private statsTable?: ElementRef<NimbleTableElement>;

  constructor(
    private readonly dataService: UsageMetricsService,
    private readonly currentUserService: CurrentUserService,
    readonly tagStatisticsService: TagStatisticsService,
    appViewState: AppViewStateService,
  ) {
    this.state = appViewState.create<UsageDashboardModel>();
  }

  ngOnInit(): void {
    void this.reload();
    void this.currentUserService.checkIsSuperUser().then(result => {
      this.isSuperUser = result;
      if (result && this.state.value) {
        void this.writeAllTags(this.state.value);
        this.queueRateLoad(this.state.value.metrics);
      }
    });
  }

  async reload(): Promise<void> {
    this.isPartialLoad = false;
    this.rateQueue = [];
    this.rateQueuedKeys = new Set();
    this.dailyRates = new Map();
    this.state = { ...this.state, isLoading: true, error: null };

    const handlePartial = (partial: readonly UsageMetric[]) => {
      this.allTreeNodes = this.buildTreeNodes(partial, true);
      this.applySearchFilter();
      if (this.isSuperUser) this.queueRateLoad(partial);
      // Show the tree as soon as any results arrive
      if (this.state.isLoading) {
        this.isPartialLoad = true;
        this.state = {
          value: { metrics: [...partial], unavailable: [], refreshedAt: new Date().toISOString() },
          isLoading: false,
          error: null,
        };
      }
    };

    try {
      const value = await this.dataService.load(handlePartial);
      this.isPartialLoad = false;
      this.allTreeNodes = this.buildTreeNodes(value.metrics);
      this.applySearchFilter();
      this.state = { value, isLoading: false, error: null };
      if (this.isSuperUser) {
        void this.writeAllTags(value);
        this.queueRateLoad(value.metrics);
      }
    } catch (error: unknown) {
      this.isPartialLoad = false;
      const message = error instanceof Error ? error.message : 'Failed to load usage metrics.';
      this.state = { ...this.state, isLoading: false, error: message };
      this.allTreeNodes = [];
      this.treeNodes = [];
    }
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLElement & { value?: string };
    this.searchTerm = (target.value ?? '').trim();
    this.applySearchFilter();
  }

  exportCsv(): void {
    const rows: string[][] = [['Parent', 'Metric', 'Status', 'Count', 'Details']];

    for (const group of this.allTreeNodes) {
      for (const child of group.children) {
        rows.push([
          group.metric,
          child.metric,
          child.statusLabel,
          child.count,
          child.details,
        ]);
      }
    }

    const csv = rows
      .map((row) => row.map((value) => this.escapeCsvValue(value)).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = href;
    anchor.download = 'systemlink-usage-metrics-' + timestamp + '.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
  }

  selectMetricRow(node: UsageTreeNode): void {
    if (node.children.length > 0) return;
    this.selectedMetricNode = this.selectedMetricNode === node ? null : node;
  }

  openStatisticsOnDoubleClick(node: UsageTreeNode): void {
    this.selectMetricRow(node);
    this.openStatisticsDialog();
  }

  openStatisticsDialog(): void {
    if (!this.selectedMetricNode) return;
    this.statisticsMetricLabel = this.selectedMetricNode.metric;
    this.statisticsMetricKey = this.selectedMetricNode.id;
    this.statisticsLoading = true;
    this.statisticsHistory = [];
    void this.statsDialog?.nativeElement.show();
    void this.tagStatisticsService.readTagHistory(this.statisticsMetricKey).then(entries => {
      this.statisticsHistory = entries;
      this.statisticsLoading = false;
      setTimeout(() => this.updateStatsTable(), 0);
    });
  }

  exportStatsCsv(): void {
    const rows: string[][] = [['Timestamp', 'Value'],
      ...this.statisticsHistoryDesc.map(e => [
        new Date(e.timestamp).toLocaleString(),
        String(e.value),
      ]),
    ];
    const csv = rows.map(r => r.map(v => '"' + v.replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = this.statisticsMetricKey + '-history.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
  }

  closeStatisticsDialog(): void {
    this.statsDialog?.nativeElement.close();
  }

  private updateStatsTable(): void {
    const rows: StatsTableRow[] = this.statisticsHistoryDesc.map((e, i) => ({
      id: String(i),
      timestamp: new Date(e.timestamp).toLocaleString(),
      value: e.value.toLocaleString(),
    }));
    void this.statsTable?.nativeElement.setData(rows);
  }

  get statisticsTagPath(): string {
    return this.statisticsMetricKey
      ? this.tagStatisticsService.tagPath(this.statisticsMetricKey)
      : '';
  }

  get statisticsHistoryDesc(): readonly TagHistoryEntry[] {
    return [...this.statisticsHistory].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  formatDailyRate(metricKey: string): string {
    if (this.dailyRatesLoading && !this.dailyRates.has(metricKey)) return '\u2026';
    const rate = this.dailyRates.get(metricKey);
    if (rate === undefined || rate === null) return '\u2014';
    if (Math.abs(rate) < 0.005) return '\u22480/d';
    const abs = Math.abs(rate);
    const str = abs < 0.1 ? abs.toFixed(2) : abs < 100 ? abs.toFixed(1) : Math.round(abs).toLocaleString();
    return (rate > 0 ? '+' : '\u2212') + str + '/d';
  }

  getDailyRateSign(metricKey: string): 'positive' | 'negative' | 'neutral' {
    const rate = this.dailyRates.get(metricKey);
    if (rate === undefined || rate === null || Math.abs(rate) < 0.005) return 'neutral';
    return rate > 0 ? 'positive' : 'negative';
  }

  private queueRateLoad(metrics: readonly UsageMetric[]): void {
    const fresh = metrics.filter(m => !this.rateQueuedKeys.has(m.key));
    if (fresh.length === 0) return;
    for (const m of fresh) this.rateQueuedKeys.add(m.key);
    this.rateQueue.push(...fresh);
    this.dailyRatesLoading = true;
    if (!this.rateWorkerActive) void this.drainRateQueue();
  }

  private async drainRateQueue(): Promise<void> {
    this.rateWorkerActive = true;
    const now = new Date().toISOString();
    while (this.rateQueue.length > 0) {
      const batch = this.rateQueue.splice(0, 3);
      const results = await Promise.allSettled(
        batch.map(async m => {
          const history = await this.tagStatisticsService.readTagHistory(m.key);
          // Seed with live value so metrics with only 1 stored entry can show a rate
          const seeded: TagHistoryEntry[] = m.value !== null
            ? [...history, { value: m.value, timestamp: now }]
            : [...history];
          return { key: m.key, rate: this.computeDailyRate(seeded) };
        }),
      );
      const updated = new Map(this.dailyRates);
      for (const r of results) {
        if (r.status === 'fulfilled') updated.set(r.value.key, r.value.rate);
      }
      this.dailyRates = updated;
      if (this.rateQueue.length > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 150));
      }
    }
    this.rateWorkerActive = false;
    this.dailyRatesLoading = false;
  }

  private computeDailyRate(history: TagHistoryEntry[]): number | null {
    if (history.length < 2) return null;
    const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const msPerDay = 86_400_000;
    const t0 = new Date(sorted[0].timestamp).getTime();
    const spanDays = (new Date(sorted[sorted.length - 1].timestamp).getTime() - t0) / msPerDay;
    // Require at least 1 hour of data span to avoid near-zero denominators
    if (spanDays < 1 / 24) return null;
    const pts = sorted.map(e => ({
      x: (new Date(e.timestamp).getTime() - t0) / msPerDay,
      y: e.value,
    }));
    const n = pts.length;
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sx2 - sx * sx;
    return denom === 0 ? null : (n * sxy - sx * sy) / denom;
  }

  private async writeAllTags(model: UsageDashboardModel): Promise<void> {
    const metrics = model.metrics
      .filter((m): m is typeof m & { value: number } => m.value !== null)
      .map(m => ({ key: m.key, value: m.value }));
    await this.tagStatisticsService.writeAllMetrics(metrics, model.refreshedAt);
  }

  private escapeCsvValue(value: string): string {
    const escaped = String(value).replace(/"/g, '""');
    return '"' + escaped + '"';
  }

  private applySearchFilter(): void {
    const term = this.searchTerm.toLowerCase();
    if (!term) {
      this.treeNodes = this.allTreeNodes;
      return;
    }

    this.treeNodes = this.allTreeNodes
      .map((group) => {
        const groupMatches = this.nodeMatches(group, term);
        if (groupMatches) {
          return {
            ...group,
            children: group.children,
          };
        }

        const matchingChildren = group.children.filter((child) => this.nodeMatches(child, term));
        if (matchingChildren.length === 0) {
          return null;
        }

        return {
          ...group,
          children: matchingChildren,
        };
      })
      .filter((group): group is UsageTreeNode => group !== null);
  }

  private nodeMatches(node: UsageTreeNode, term: string): boolean {
    return (
      node.metric.toLowerCase().includes(term) ||
      node.details.toLowerCase().includes(term) ||
      node.count.toLowerCase().includes(term)
    );
  }

  private toMetricNode(metric: UsageMetric): UsageTreeNode {
    const hasValue = metric.value !== null;
    const statusGlyph: UsageStatusGlyph = hasValue
      ? 'pass'
      : metric.status === 'unauthorized'
        ? 'lock'
        : 'fail';
    const statusLabel = hasValue
      ? 'Pass'
      : metric.status === 'unauthorized'
        ? 'Unauthorized'
        : 'Fail';
    const metricLabel = metric.key.startsWith('work-item-type:')
      ? this.formatSchedulingTypeLabel(metric.label)
      : metric.label;

    return {
      id: metric.key,
      metric: metricLabel,
      count: hasValue ? String(metric.value) : 'N/A',
      details: metric.detail,
      source: metric.source,
      statusGlyph,
      statusLabel,
      children: [],
    };
  }

  private buildTreeNodes(metrics: readonly UsageMetric[], isPartial = false): readonly UsageTreeNode[] {
    const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
    const workItemTypeMetrics = metrics
      .filter((metric) => metric.key.startsWith('work-item-type:'))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    const nodes: UsageTreeNode[] = [];

    for (const group of HomePageComponent.GROUPS) {
      const children: UsageTreeNode[] = [];
      for (const child of group.children) {
        if (child.key === 'work-item-types-dynamic') {
          if (workItemTypeMetrics.length === 0) {
            children.push({
              id: `metric-${group.key}-${child.key}`,
              metric: child.label,
              count: 'N/A',
              details: child.fallbackDetail,
              source: 'Not wired yet',
              statusGlyph: 'fail',
              statusLabel: 'Fail',
              children: [],
            });
          } else {
            for (const typeMetric of workItemTypeMetrics) {
              children.push(this.toMetricNode(typeMetric));
            }
          }

          continue;
        }

        const metric = byKey.get(child.key);
        if (!metric) {
          children.push({
            id: `metric-${group.key}-${child.key}`,
            metric: child.label,
            count: isPartial ? '\u2026' : 'N/A',
            details: child.fallbackDetail,
            source: isPartial ? 'Loading\u2026' : 'Not wired yet',
            statusGlyph: isPartial ? 'pending' : 'fail',
            statusLabel: isPartial ? 'Loading' : 'Fail',
            children: [],
          });
          continue;
        }

        children.push(
          this.toMetricNode({
            ...metric,
            label: child.label,
          }),
        );
      }

      nodes.push({
        id: `group-${group.key}`,
        metric: group.label,
        count: '-',
        details: group.description,
        source: '-',
        statusGlyph: 'none',
        statusLabel: 'Group',
        children,
      });
    }

    return nodes;
  }

  private formatSchedulingTypeLabel(label: string): string {
    const normalized = label
      .replace(/workitem/gi, 'work item')
      .replace(/workorder/gi, 'work order')
      .replace(/transportorders/gi, 'transport orders')
      .replace(/transportorder/gi, 'transport order')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
      .replace(/\s+/g, ' ');

    if (normalized.length === 0) {
      return 'Work Items';
    }

    const titled = normalized
      .split(' ')
      .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
      .join(' ');

    const lower = titled.toLowerCase();
    if (lower === 'maintenance') {
      return titled;
    }

    return lower.endsWith('s') ? titled : `${titled}s`;
  }
}
