import {
  DashboardCacheData,
  DashboardInsightsReport,
} from "./interfaces/IDashboardService";
import { escapeXml } from "./utils/XmlUtils";

export class DashboardHtmlGenerator {
  static generateHtml(
    initialReport: DashboardInsightsReport,
    cacheData?: DashboardCacheData,
    options: { isLiveServer?: boolean } = {}
  ): string {
    const safeProject = escapeXml(initialReport.project || "ADO Project");
    const safeOrg = escapeXml(initialReport.orgUrl || "");

    // Embed both the initial report and the underlying runs so client-side filtering works 100% offline in static snapshots
    const embeddedPayload = {
      isLiveServer: Boolean(options.isLiveServer),
      initialReport,
      allRuns: cacheData?.runs || initialReport.runs || [],
    };

    // Safely serialize JSON for embedding inside a <script> tag (prevent </script> injection)
    const safeJsonPayload = JSON.stringify(embeddedPayload)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ADO Test Runs Insights — ${safeProject}</title>
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-secondary: #111827;
      --bg-card: #161f33;
      --bg-card-hover: #1d2842;
      --bg-elevated: #1e293b;
      --border-subtle: rgba(148, 163, 184, 0.14);
      --border-focus: rgba(56, 189, 248, 0.45);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-pipeline: #38bdf8;
      --accent-reporter: #818cf8;
      --accent-direct: #f59e0b;
      --status-pass: #10b981;
      --status-fail: #f43f5e;
      --status-flaky: #eab308;
      --status-blocked: #a855f7;
      --radius-md: 10px;
      --radius-lg: 14px;
      --shadow-card: 0 10px 25px -5px rgba(0, 0, 0, 0.35);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: radial-gradient(circle at 15% 0%, #172554 0%, var(--bg-primary) 42%);
      color: var(--text-primary);
      font-family: var(--font-sans);
      line-height: 1.5;
      min-height: 100vh;
      padding-bottom: 48px;
    }

    a {
      color: var(--accent-pipeline);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }

    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* Top Header */
    .top-header {
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(15, 23, 42, 0.82);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 40;
      padding: 14px 0;
    }

    .header-inner {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);
    }

    .brand-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .badge-pipeline {
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .badge-reporter {
      background: rgba(129, 140, 248, 0.16);
      color: #a5b4fc;
      border: 1px solid rgba(129, 140, 248, 0.35);
    }

    .badge-direct {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }

    .badge-pass {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .badge-fail {
      background: rgba(244, 63, 94, 0.15);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.35);
    }

    .badge-flaky {
      background: rgba(234, 179, 8, 0.15);
      color: #fde047;
      border: 1px solid rgba(234, 179, 8, 0.35);
    }

    .badge-demo {
      background: rgba(168, 85, 247, 0.16);
      color: #d8b4fe;
      border: 1px solid rgba(168, 85, 247, 0.35);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      color: var(--text-primary);
      transition: all 0.15s ease;
    }

    .btn:hover {
      background: #283548;
      border-color: var(--border-focus);
      text-decoration: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, #0284c7, #4f46e5);
      border-color: rgba(56, 189, 248, 0.4);
      color: #fff;
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #0369a1, #4338ca);
    }

    /* Filter Bar */
    .filter-bar {
      margin-top: 20px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 16px 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      box-shadow: var(--shadow-card);
    }

    .filter-group {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
    }

    .filter-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .filter-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }

    .filter-input,
    .filter-select {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      color: var(--text-primary);
      padding: 7px 11px;
      border-radius: 8px;
      font-size: 13px;
      font-family: var(--font-sans);
      outline: none;
    }

    .filter-input:focus,
    .filter-select:focus {
      border-color: var(--accent-pipeline);
    }

    .preset-pills {
      display: flex;
      background: var(--bg-secondary);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      gap: 2px;
    }

    .preset-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .preset-btn.active,
    .preset-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .preset-btn.active {
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
    }

    /* KPI Strip */
    .kpi-grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 14px;
    }

    @media (max-width: 1280px) {
      .kpi-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    @media (max-width: 768px) {
      .kpi-grid {
        grid-template-columns: repeat(1, 1fr);
      }
    }

    .kpi-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      box-shadow: var(--shadow-card);
      position: relative;
      overflow: hidden;
    }

    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--kpi-accent, var(--accent-pipeline));
    }

    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }

    .kpi-value-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }

    .kpi-value {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .kpi-sub {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .split-bar {
      width: 100%;
      height: 7px;
      background: rgba(255, 255, 255, 0.07);
      border-radius: 999px;
      overflow: hidden;
      display: flex;
    }

    .split-bar-pipeline {
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      height: 100%;
    }

    .split-bar-direct {
      background: var(--accent-direct);
      height: 100%;
    }

    .kpi-legend {
      display: flex;
      justify-content: space-between;
      font-size: 11.5px;
      color: var(--text-secondary);
    }

    /* Visual Insights Row */
    .insights-grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 18px;
    }

    @media (max-width: 1100px) {
      .insights-grid {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 20px;
      box-shadow: var(--shadow-card);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
    }

    .panel-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .panel-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    /* Head-to-Head Comparison Cards inside Panel */
    .comparison-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }

    .comp-box {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 14px;
    }

    .comp-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .comp-stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      font-size: 12px;
    }

    .comp-stat-val {
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .comp-stat-lbl {
      font-size: 11px;
      color: var(--text-secondary);
    }

    /* Tabs */
    .tabs-bar {
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 12px;
    }

    .tab-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tab-btn {
      padding: 9px 16px;
      border-radius: 9px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s;
    }

    .tab-btn.active {
      background: rgba(56, 189, 248, 0.16);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.45);
    }

    .tab-count {
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 7px;
      border-radius: 99px;
      font-size: 11px;
    }

    /* Tables */
    .table-wrap {
      overflow-x: auto;
      margin-top: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th {
      text-align: left;
      padding: 11px 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      background: rgba(15, 23, 42, 0.6);
      border-bottom: 1px solid var(--border-subtle);
      white-space: nowrap;
    }

    td {
      padding: 12px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
    }

    tr.run-row {
      cursor: pointer;
      transition: background 0.12s;
    }

    tr.run-row:hover {
      background: var(--bg-card-hover);
    }

    tr.drawer-row {
      background: #0d1322;
    }

    .drawer-content {
      padding: 14px 18px;
      border-left: 3px solid var(--accent-pipeline);
    }

    .progress-mini {
      width: 110px;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
      display: flex;
      margin-top: 4px;
    }

    .progress-pass {
      background: var(--status-pass);
      height: 100%;
    }

    .progress-fail {
      background: var(--status-fail);
      height: 100%;
    }

    .progress-other {
      background: var(--status-blocked);
      height: 100%;
    }

    .spark-seq {
      display: inline-flex;
      gap: 3px;
      align-items: center;
    }

    .spark-dot {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .spark-P {
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    .spark-F {
      background: rgba(244, 63, 94, 0.22);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.4);
    }

    .mono {
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .error-box {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: #fda4af;
      background: rgba(244, 63, 94, 0.08);
      border: 1px solid rgba(244, 63, 94, 0.2);
      padding: 6px 10px;
      border-radius: 6px;
      max-width: 460px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      border: 1px solid var(--accent-pipeline);
      color: var(--text-primary);
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
      display: none;
      z-index: 100;
    }

    .sub-section-title {
      font-size: 14px;
      font-weight: 700;
      margin: 18px 0 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--text-secondary);
      font-size: 13.5px;
    }
  </style>
</head>
<body>
  <header class="top-header">
    <div class="container header-inner">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-title">
            ADO Test Runs Insights Dashboard
            <span id="dataModeBadge" class="badge badge-pipeline">Cached</span>
          </div>
          <div class="brand-subtitle">
            <span>Project: <strong id="projectLabel">${safeProject}</strong></span>
            <span>•</span>
            <span>Org: <span class="mono" id="orgLabel">${safeOrg}</span></span>
            <span>•</span>
            <span id="syncStatusText">Last synced: —</span>
          </div>
        </div>
      </div>

      <div class="header-actions">
        <button id="syncAdoBtn" class="btn btn-primary" style="display: none;" onclick="syncFromAdo()">
          🔄 Sync Live from ADO
        </button>
        <button class="btn" onclick="copyMarkdownReport()">
          📋 Copy Triage Markdown
        </button>
        <button class="btn" onclick="downloadCsvReport()">
          📥 Export CSV
        </button>
        <button class="btn" onclick="downloadHtmlSnapshot()">
          💾 Save HTML Snapshot
        </button>
      </div>
    </div>
  </header>

  <main class="container">
    <!-- Filter & Date Range Bar -->
    <section class="filter-bar">
      <div class="filter-group">
        <div class="filter-field">
          <span class="filter-label">Quick Window</span>
          <div class="preset-pills">
            <button class="preset-btn" data-days="1" onclick="applyDatePreset(1)">24h</button>
            <button class="preset-btn" data-days="7" onclick="applyDatePreset(7)">7d</button>
            <button class="preset-btn" data-days="14" onclick="applyDatePreset(14)">14d</button>
            <button class="preset-btn active" data-days="30" onclick="applyDatePreset(30)">30d</button>
            <button class="preset-btn" data-days="90" onclick="applyDatePreset(90)">90d</button>
          </div>
        </div>

        <div class="filter-field">
          <label class="filter-label" for="startDateInput">Start Date</label>
          <input type="date" id="startDateInput" class="filter-input" onchange="onFilterChange()" />
        </div>

        <div class="filter-field">
          <label class="filter-label" for="endDateInput">End Date</label>
          <input type="date" id="endDateInput" class="filter-input" onchange="onFilterChange()" />
        </div>

        <div class="filter-field">
          <label class="filter-label" for="sourceSelect">Execution Source</label>
          <select id="sourceSelect" class="filter-select" onchange="onFilterChange()">
            <option value="all">All Sources (Pipeline + Direct ADO)</option>
            <option value="pipeline">🚀 Azure Pipelines (Automated)</option>
            <option value="direct_ado">🧭 Direct in ADO (Manual / Exploratory)</option>
          </select>
        </div>

        <div class="filter-field">
          <label class="filter-label" for="subSourceSelect">Runner / Sub-Source</label>
          <select id="subSourceSelect" class="filter-select" onchange="onFilterChange()">
            <option value="all">All Sub-Sources</option>
            <option value="ado_test_reporter">📦 ADO Test Reporter CLI</option>
            <option value="azure_pipeline">⚙️ Standard Azure Pipeline Task</option>
            <option value="direct_manual">🧑‍💻 Direct ADO Manual Runner</option>
          </select>
        </div>

        <div class="filter-field">
          <label class="filter-label" for="planSelect">Test Plan</label>
          <select id="planSelect" class="filter-select" onchange="onFilterChange()">
            <option value="all">All Test Plans</option>
          </select>
        </div>

        <div class="filter-field">
          <label class="filter-label" for="buildSelect">Build</label>
          <select id="buildSelect" class="filter-select" onchange="onFilterChange()">
            <option value="all">All Builds</option>
          </select>
        </div>
      </div>

      <div class="filter-field" style="min-width: 210px;">
        <label class="filter-label" for="searchBox">Search Run / Test / TC ID</label>
        <input
          type="search"
          id="searchBox"
          class="filter-input"
          placeholder="e.g. TC1015, Checkout, 202611..."
          oninput="renderActiveTab()"
        />
      </div>
    </section>

    <!-- 6-Card Executive KPI Strip -->
    <section class="kpi-grid" id="kpiGrid"></section>

    <!-- Visual Insights Grid: Pipeline vs Direct ADO -->
    <section class="insights-grid">
      <!-- Left Panel: Execution Volume Trend (Pipeline vs Direct ADO) -->
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Tests Executed in Azure Pipelines vs. Direct in ADO Over Time</div>
            <div class="panel-subtitle" id="trendSubtitle">
              Daily breakdown comparing automated pipeline executions against manual ADO runs
            </div>
          </div>
          <div class="preset-pills">
            <button id="metricToggleTests" class="preset-btn active" onclick="setTrendMetric('tests')">Test Cases</button>
            <button id="metricToggleRuns" class="preset-btn" onclick="setTrendMetric('runs')">Test Runs</button>
          </div>
        </div>
        <div id="volumeTrendChart" style="width: 100%; height: 265px;"></div>
      </div>

      <!-- Right Panel: Head-to-Head Source Comparison & Pass Rate -->
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Execution Source Head-to-Head Comparison</div>
            <div class="panel-subtitle">
              Direct comparison of reliability, velocity, and runner distribution
            </div>
          </div>
        </div>
        <div class="comparison-cards" id="headToHeadCards"></div>
        <div id="passRateTrendChart" style="width: 100%; height: 155px;"></div>
      </div>
    </section>

    <!-- Interactive Drill-Down Tabs -->
    <section class="tabs-bar">
      <div class="tab-buttons">
        <button class="tab-btn active" id="tabBtn-runs" onclick="switchTab('runs')">
          🗂️ Test Runs Explorer <span class="tab-count" id="count-runs">0</span>
        </button>
        <button class="tab-btn" id="tabBtn-triage" onclick="switchTab('triage')">
          🚨 Actionable Failures &amp; Flaky Triage <span class="tab-count" id="count-triage">0</span>
        </button>
        <button class="tab-btn" id="tabBtn-performance" onclick="switchTab('performance')">
          ⚡ Slowest Tests &amp; Suite Health <span class="tab-count" id="count-performance">0</span>
        </button>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary);">
        💡 Click any Test Run row to expand individual test case outcomes, error traces, and ADO links.
      </div>
    </section>

    <section class="panel" style="margin-top: 14px;" id="tabContentPanel"></section>
  </main>

  <div id="toast" class="toast"></div>

  <script>
    const PAYLOAD = ${safeJsonPayload};
    let allRuns = PAYLOAD.allRuns || [];
    let currentReport = PAYLOAD.initialReport;
    let activeTab = 'runs';
    let trendMetric = 'tests';
    let expandedRunIds = new Set();

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatDuration(ms) {
      if (!ms || ms <= 0) return '0ms';
      if (ms < 1000) return Math.round(ms) + 'ms';
      const sec = ms / 1000;
      if (sec < 60) return sec.toFixed(1) + 's';
      const min = Math.floor(sec / 60);
      const remSec = Math.round(sec % 60);
      return min + 'm ' + remSec + 's';
    }

    function formatDateShort(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => {
        el.style.display = 'none';
      }, 3200);
    }

    function computePercentile(vals, pct) {
      if (!vals || vals.length === 0) return 0;
      const sorted = [...vals].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
      return Math.round(sorted[idx]);
    }

    function initDashboard() {
      if (PAYLOAD.isLiveServer) {
        document.getElementById('syncAdoBtn').style.display = 'inline-flex';
      }

      const startInput = document.getElementById('startDateInput');
      const endInput = document.getElementById('endDateInput');
      startInput.value = currentReport.filter.startDate;
      endInput.value = currentReport.filter.endDate;

      populateDropdowns();
      renderAll();
    }

    function populateDropdowns() {
      const planSelect = document.getElementById('planSelect');
      const buildSelect = document.getElementById('buildSelect');
      const currentPlan = planSelect.value || 'all';
      const currentBuild = buildSelect.value || 'all';

      const plans = new Set();
      const builds = new Set();
      for (const r of allRuns) {
        if (r.planName) plans.add(r.planName);
        if (r.buildNumber) builds.add(r.buildNumber);
      }

      planSelect.innerHTML = '<option value="all">All Test Plans</option>' +
        Array.from(plans).sort().map(p => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
      buildSelect.innerHTML = '<option value="all">All Builds</option>' +
        Array.from(builds).sort().map(b => '<option value="' + escapeHtml(b) + '">' + escapeHtml(b) + '</option>').join('');

      planSelect.value = currentPlan;
      buildSelect.value = currentBuild;
    }

    function applyDatePreset(days) {
      document.querySelectorAll('.preset-pills .preset-btn[data-days]').forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-days')) === days);
      });

      const latestTime = allRuns.length > 0
        ? Math.max(...allRuns.map(r => new Date(r.completedDate).getTime()))
        : Date.now();
      const end = new Date(Math.max(Date.now(), latestTime));
      const start = new Date(end.getTime() - days * 86400000);

      document.getElementById('startDateInput').value = start.toISOString().slice(0, 10);
      document.getElementById('endDateInput').value = end.toISOString().slice(0, 10);
      onFilterChange();
    }

    async function onFilterChange() {
      const filter = {
        startDate: document.getElementById('startDateInput').value,
        endDate: document.getElementById('endDateInput').value,
        executionSource: document.getElementById('sourceSelect').value,
        executionSubSource: document.getElementById('subSourceSelect').value,
        planName: document.getElementById('planSelect').value,
        buildNumber: document.getElementById('buildSelect').value,
      };

      if (PAYLOAD.isLiveServer) {
        try {
          const qs = new URLSearchParams(filter).toString();
          const res = await fetch('/api/report?' + qs);
          if (res.ok) {
            currentReport = await res.json();
            renderAll();
            return;
          }
        } catch (e) {
          // Fallback to client-side computation if offline
        }
      }

      currentReport = recomputeReportClientSide(filter);
      renderAll();
    }

    function recomputeReportClientSide(filter) {
      const start = new Date(filter.startDate + 'T00:00:00.000Z');
      const end = new Date(filter.endDate + 'T23:59:59.999Z');

      const filterFn = (r, s, e) => {
        const dt = new Date(r.completedDate);
        if (dt < s || dt > e) return false;
        if (filter.planName !== 'all' && (r.planName || '') !== filter.planName) return false;
        if (filter.buildNumber !== 'all' && (r.buildNumber || '') !== filter.buildNumber) return false;
        if (filter.executionSource !== 'all' && r.executionSource !== filter.executionSource) return false;
        if (filter.executionSubSource !== 'all' && r.executionSubSource !== filter.executionSubSource) return false;
        return true;
      };

      const filtered = allRuns.filter(r => filterFn(r, start, end));
      const winMs = Math.max(86400000, end.getTime() - start.getTime());
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - winMs);
      const prevFiltered = allRuns.filter(r => filterFn(r, prevStart, prevEnd));

      const calcStats = (list) => {
        let tests = 0, passed = 0, failed = 0, blocked = 0, notExecuted = 0, other = 0;
        const rDur = [], tDur = [];
        for (const r of list) {
          tests += r.totalTests;
          passed += r.passedTests;
          failed += r.failedTests;
          blocked += r.blockedTests;
          notExecuted += r.notExecutedTests;
          other += r.otherTests;
          rDur.push(r.durationMs);
          for (const res of r.results || []) tDur.push(res.durationMs);
        }
        return {
          runs: list.length,
          tests,
          passed,
          failed,
          blocked,
          notExecuted,
          other,
          passRate: tests > 0 ? Number(((passed / tests) * 100).toFixed(1)) : 0,
          avgRunDurationMs: rDur.length ? Math.round(rDur.reduce((a, b) => a + b, 0) / rDur.length) : 0,
          p95RunDurationMs: computePercentile(rDur, 95),
          avgTestDurationMs: tDur.length ? Math.round(tDur.reduce((a, b) => a + b, 0) / tDur.length) : 0,
          p95TestDurationMs: computePercentile(tDur, 95),
        };
      };

      const pRuns = filtered.filter(r => r.executionSource === 'pipeline');
      const dRuns = filtered.filter(r => r.executionSource === 'direct_ado');
      const repRuns = filtered.filter(r => r.executionSubSource === 'ado_test_reporter');
      const natRuns = filtered.filter(r => r.executionSubSource === 'azure_pipeline');

      const oStats = calcStats(filtered);
      const pStats = calcStats(pRuns);
      const dStats = calcStats(dRuns);
      const repStats = calcStats(repRuns);
      const natStats = calcStats(natRuns);
      const prevStats = calcStats(prevFiltered);

      const passRateDeltaPct = prevStats.tests > 0
        ? Number((oStats.passRate - prevStats.passRate).toFixed(1))
        : 0;

      // Chronological runs for flaky & regressions
      const chrono = [...filtered].sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate));
      const byTest = new Map();
      for (const r of chrono) {
        for (const res of r.results || []) {
          const k = res.testCaseId ? 'TC_' + res.testCaseId : 'TITLE_' + res.testCaseTitle;
          if (!byTest.has(k)) byTest.set(k, []);
          byTest.get(k).push({ run: r, res });
        }
      }

      const flakyTests = [];
      const newRegressions = [];
      const slowMap = new Map();

      for (const [k, hist] of byTest.entries()) {
        const outcomes = hist.map(h => h.res.outcome);
        const passCount = outcomes.filter(o => o === 'Passed').length;
        const failCount = outcomes.filter(o => o === 'Failed').length;
        const last = hist[hist.length - 1];

        if (passCount > 0 && failCount > 0) {
          const pf = outcomes.filter(o => o === 'Passed' || o === 'Failed');
          let flips = 0;
          for (let i = 1; i < pf.length; i++) if (pf[i] !== pf[i - 1]) flips++;
          flakyTests.push({
            testKey: k,
            testCaseId: last.res.testCaseId,
            testCaseTitle: last.res.testCaseTitle,
            totalExecutions: outcomes.length,
            passCount,
            failCount,
            oscillationCount: flips,
            flipRatePct: pf.length > 1 ? Number(((flips / (pf.length - 1)) * 100).toFixed(1)) : 0,
            pipelineExecutions: hist.filter(h => h.res.executionSource === 'pipeline').length,
            directAdoExecutions: hist.filter(h => h.res.executionSource === 'direct_ado').length,
            latestOutcome: last.res.outcome,
            outcomeSequence: outcomes.slice(-10),
            testCaseUrl: last.res.testCaseUrl,
            linkedDefect: hist.find(h => h.res.linkedDefect)?.res.linkedDefect,
          });
        }

        if (last.res.outcome === 'Failed') {
          let consec = 0;
          let since = last.run.completedDate;
          for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].res.outcome === 'Failed') {
              consec++;
              since = hist[i].run.completedDate;
            } else if (hist[i].res.outcome === 'Passed') break;
          }
          newRegressions.push({
            testCaseId: last.res.testCaseId || 'Unlinked',
            testCaseTitle: last.res.testCaseTitle,
            latestRunId: last.run.runId,
            latestRunName: last.run.name,
            latestCompletedDate: last.run.completedDate,
            previousPassedCount: hist.slice(0, -1).filter(h => h.res.outcome === 'Passed').length,
            consecutiveFailures: consec,
            failingSinceDate: since,
            errorMessage: last.res.errorMessage,
            executionSource: last.res.executionSource,
            executionSubSource: last.res.executionSubSource,
            testCaseUrl: last.res.testCaseUrl,
            runUrl: last.run.runUrl,
            linkedDefect: last.res.linkedDefect,
          });
        }

        const durs = hist.map(h => h.res.durationMs);
        slowMap.set(k, {
          testKey: k,
          testCaseId: last.res.testCaseId,
          testCaseTitle: last.res.testCaseTitle,
          executions: durs.length,
          maxDurationMs: Math.max(...durs),
          p95DurationMs: computePercentile(durs, 95),
          avgDurationMs: Math.round(durs.reduce((a, b) => a + b, 0) / durs.length),
          executionSource: last.res.executionSource,
          executionSubSource: last.res.executionSubSource,
          latestRunId: last.run.runId,
          runUrl: last.run.runUrl,
          testCaseUrl: last.res.testCaseUrl,
        });
      }

      flakyTests.sort((a, b) => b.oscillationCount - a.oscillationCount);
      newRegressions.sort((a, b) => new Date(b.latestCompletedDate) - new Date(a.latestCompletedDate));
      const slowestTests = Array.from(slowMap.values()).sort((a, b) => b.p95DurationMs - a.p95DurationMs).slice(0, 20);

      // Recurring failures
      const recMap = new Map();
      const defectIds = new Set();
      const failKeys = new Set();
      const covKeys = new Set();

      for (const r of filtered) {
        for (const res of r.results || []) {
          if (res.linkedDefect && res.linkedDefect.state !== 'Closed' && res.linkedDefect.state !== 'Done') {
            defectIds.add(res.linkedDefect.workItemId);
          }
          if (res.outcome !== 'Failed') continue;
          const fk = res.testCaseId || res.testCaseTitle;
          failKeys.add(fk);
          if (res.linkedDefect) covKeys.add(fk);

          const h = res.errorHash || res.errorMessage || res.testCaseTitle;
          if (!recMap.has(h)) {
            recMap.set(h, {
              errorHash: h,
              errorSnippet: (res.errorMessage || 'Unspecified failure').slice(0, 220),
              occurrences: 0,
              tcIds: new Set(),
              tcTitles: new Set(),
              pipelineOccurrences: 0,
              directAdoOccurrences: 0,
              latestRunId: r.runId,
              latestFailureDate: r.completedDate,
              sampleRunUrl: r.runUrl,
              linkedDefect: res.linkedDefect,
            });
          }
          const g = recMap.get(h);
          g.occurrences++;
          if (res.testCaseId) g.tcIds.add(res.testCaseId);
          g.tcTitles.add(res.testCaseTitle);
          if (res.executionSource === 'pipeline') g.pipelineOccurrences++;
          else g.directAdoOccurrences++;
          if (res.linkedDefect && !g.linkedDefect) g.linkedDefect = res.linkedDefect;
        }
      }

      const recurringFailures = Array.from(recMap.values()).map(g => ({
        ...g,
        affectedTestCaseIds: Array.from(g.tcIds),
        affectedTestTitles: Array.from(g.tcTitles),
      })).sort((a, b) => b.occurrences - a.occurrences);

      // Trends by day
      const bucketMap = new Map();
      for (const r of chrono) {
        const dKey = new Date(r.completedDate).toISOString().slice(0, 10);
        if (!bucketMap.has(dKey)) {
          bucketMap.set(dKey, {
            label: dKey.slice(5),
            bucketStart: dKey,
            bucketEnd: dKey,
            pipelineRuns: 0,
            directAdoRuns: 0,
            reporterRuns: 0,
            nativePipelineRuns: 0,
            pipelineTests: 0,
            directAdoTests: 0,
            pipelinePassed: 0,
            pipelineFailed: 0,
            directAdoPassed: 0,
            directAdoFailed: 0,
          });
        }
        const b = bucketMap.get(dKey);
        if (r.executionSource === 'pipeline') {
          b.pipelineRuns++;
          b.pipelineTests += r.totalTests;
          b.pipelinePassed += r.passedTests;
          b.pipelineFailed += r.failedTests;
          if (r.executionSubSource === 'ado_test_reporter') b.reporterRuns++;
          else b.nativePipelineRuns++;
        } else {
          b.directAdoRuns++;
          b.directAdoTests += r.totalTests;
          b.directAdoPassed += r.passedTests;
          b.directAdoFailed += r.failedTests;
        }
      }

      const buckets = Array.from(bucketMap.values()).map(b => {
        const tot = b.pipelineTests + b.directAdoTests;
        const pass = b.pipelinePassed + b.directAdoPassed;
        return {
          ...b,
          overallPassRate: tot > 0 ? Number(((pass / tot) * 100).toFixed(1)) : 0,
          pipelinePassRate: b.pipelineTests > 0 ? Number(((b.pipelinePassed / b.pipelineTests) * 100).toFixed(1)) : 0,
          directAdoPassRate: b.directAdoTests > 0 ? Number(((b.directAdoPassed / b.directAdoTests) * 100).toFixed(1)) : 0,
        };
      });

      // Plan suite health
      const psMap = new Map();
      const flakySet = new Set(flakyTests.map(f => f.testKey));
      for (const r of filtered) {
        const pk = (r.planName || 'Unassigned') + ':::' + (r.suiteName || 'Default');
        if (!psMap.has(pk)) {
          psMap.set(pk, {
            planName: r.planName || 'Unassigned Plan',
            suiteName: r.suiteName || 'Default Suite',
            totalRuns: 0,
            pipelineRuns: 0,
            directAdoRuns: 0,
            totalTests: 0,
            pipelineTests: 0,
            directAdoTests: 0,
            passedTests: 0,
            failedTests: 0,
            flakyKeys: new Set(),
          });
        }
        const ps = psMap.get(pk);
        ps.totalRuns++;
        ps.totalTests += r.totalTests;
        ps.passedTests += r.passedTests;
        ps.failedTests += r.failedTests;
        if (r.executionSource === 'pipeline') {
          ps.pipelineRuns++;
          ps.pipelineTests += r.totalTests;
        } else {
          ps.directAdoRuns++;
          ps.directAdoTests += r.totalTests;
        }
        for (const res of r.results || []) {
          const tk = res.testCaseId ? 'TC_' + res.testCaseId : 'TITLE_' + res.testCaseTitle;
          if (flakySet.has(tk)) ps.flakyKeys.add(tk);
        }
      }

      const planSuiteHealth = Array.from(psMap.values()).map(ps => ({
        ...ps,
        passRate: ps.totalTests > 0 ? Number(((ps.passedTests / ps.totalTests) * 100).toFixed(1)) : 0,
        flakyCount: ps.flakyKeys.size,
      })).sort((a, b) => b.totalTests - a.totalTests);

      return {
        ...currentReport,
        filter,
        kpis: {
          totalRuns: oStats.runs,
          pipelineRuns: pStats.runs,
          directAdoRuns: dStats.runs,
          reporterRuns: repStats.runs,
          nativePipelineRuns: natStats.runs,
          totalTests: oStats.tests,
          pipelineTests: pStats.tests,
          directAdoTests: dStats.tests,
          automationSharePct: oStats.tests > 0 ? Number(((pStats.tests / oStats.tests) * 100).toFixed(1)) : 0,
          runAutomationSharePct: oStats.runs > 0 ? Number(((pStats.runs / oStats.runs) * 100).toFixed(1)) : 0,
          overallPassRate: oStats.passRate,
          pipelinePassRate: pStats.passRate,
          directAdoPassRate: dStats.passRate,
          passRateDeltaPct,
          flakyTestCount: flakyTests.length,
          newRegressionCount: newRegressions.length,
          recurringFailureGroupCount: recurringFailures.length,
          openLinkedDefectsCount: defectIds.size,
          defectCoveragePct: failKeys.size > 0 ? Number(((covKeys.size / failKeys.size) * 100).toFixed(1)) : 100,
          avgRunDurationMs: oStats.avgRunDurationMs,
          p95RunDurationMs: oStats.p95RunDurationMs,
          avgTestDurationMs: oStats.avgTestDurationMs,
          p95TestDurationMs: oStats.p95TestDurationMs,
        },
        sourceComparison: {
          pipeline: pStats,
          directAdo: dStats,
          subSources: {
            adoTestReporter: repStats,
            azurePipeline: natStats,
            directManual: dStats,
          },
        },
        trends: { bucketUnit: 'day', buckets },
        planSuiteHealth,
        triage: {
          newRegressions,
          recurringFailures,
          flakyTests,
          slowestTests,
        },
        runs: filtered,
      };
    }

    function renderAll() {
      const { cacheInfo, kpis } = currentReport;
      const badge = document.getElementById('dataModeBadge');
      if (cacheInfo.isDemoData) {
        badge.className = 'badge badge-demo';
        badge.textContent = 'Offline Sample Dataset (Cached)';
      } else {
        badge.className = 'badge badge-pass';
        badge.textContent = 'ADO Synced Cache';
      }

      document.getElementById('syncStatusText').textContent =
        'Last synced: ' + (cacheInfo.lastSyncedAt ? formatDateShort(cacheInfo.lastSyncedAt) : 'Local Cache') +
        ' (' + cacheInfo.totalCachedRuns + ' cached runs)';

      renderKpiStrip();
      renderVolumeTrendChart();
      renderHeadToHeadComparison();
      renderPassRateTrendChart();

      document.getElementById('count-runs').textContent = currentReport.runs.length;
      document.getElementById('count-triage').textContent =
        kpis.newRegressionCount + kpis.flakyTestCount;
      document.getElementById('count-performance').textContent =
        currentReport.triage.slowestTests.length;

      renderActiveTab();
    }

    function renderKpiStrip() {
      const k = currentReport.kpis;
      const directSharePct = k.totalTests > 0 ? Number((100 - k.automationSharePct).toFixed(1)) : 0;
      const deltaSign = k.passRateDeltaPct >= 0 ? '+' : '';
      const deltaBadgeClass = k.passRateDeltaPct >= 0 ? 'badge-pass' : 'badge-fail';

      document.getElementById('kpiGrid').innerHTML = \`
        <!-- Card 1: Pipeline vs Direct ADO Execution Split -->
        <div class="kpi-card" style="--kpi-accent: #38bdf8;">
          <div class="kpi-header">
            <span>Execution Source Split</span>
            <span class="badge badge-pipeline">\${k.automationSharePct}% Pipeline</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value">\${k.totalTests.toLocaleString()}</span>
            <span class="kpi-sub">tests across <strong>\${k.totalRuns}</strong> runs</span>
          </div>
          <div class="split-bar">
            <div class="split-bar-pipeline" style="width: \${k.automationSharePct}%" title="Azure Pipelines: \${k.pipelineTests} tests"></div>
            <div class="split-bar-direct" style="width: \${directSharePct}%" title="Direct in ADO: \${k.directAdoTests} tests"></div>
          </div>
          <div class="kpi-legend">
            <span style="color: #38bdf8;">🚀 Pipeline: <strong>\${k.pipelineTests}</strong> (\${k.pipelineRuns} runs)</span>
            <span style="color: #fbbf24;">🧭 Direct ADO: <strong>\${k.directAdoTests}</strong> (\${k.directAdoRuns} runs)</span>
          </div>
        </div>

        <!-- Card 2: ADO Test Reporter vs Native CI Breakdown -->
        <div class="kpi-card" style="--kpi-accent: #818cf8;">
          <div class="kpi-header">
            <span>Runner Breakdown</span>
            <span class="badge badge-reporter">Sub-Sources</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value">\${k.reporterRuns}</span>
            <span class="kpi-sub">ADO Reporter runs</span>
          </div>
          <div class="kpi-legend" style="flex-direction: column; gap: 3px;">
            <span>📦 ADO Reporter CLI: <strong>\${currentReport.sourceComparison.subSources.adoTestReporter.tests}</strong> tests (\${k.reporterRuns} runs)</span>
            <span>⚙️ Native Pipeline CI: <strong>\${currentReport.sourceComparison.subSources.azurePipeline.tests}</strong> tests (\${k.nativePipelineRuns} runs)</span>
            <span>🧑‍💻 Direct ADO Manual: <strong>\${k.directAdoTests}</strong> tests (\${k.directAdoRuns} runs)</span>
          </div>
        </div>

        <!-- Card 3: Pass Rate & Period Delta -->
        <div class="kpi-card" style="--kpi-accent: #10b981;">
          <div class="kpi-header">
            <span>Pass Rate &amp; Trend</span>
            <span class="badge \${deltaBadgeClass}">\${deltaSign}\${k.passRateDeltaPct}% vs prev</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value" style="color: \${k.overallPassRate >= 90 ? '#34d399' : k.overallPassRate >= 75 ? '#fde047' : '#fb7185'};">\${k.overallPassRate}%</span>
            <span class="kpi-sub">overall pass rate</span>
          </div>
          <div class="kpi-legend">
            <span>🚀 Pipeline: <strong>\${k.pipelinePassRate}%</strong></span>
            <span>🧭 Direct ADO: <strong>\${k.directAdoPassRate}%</strong></span>
          </div>
        </div>

        <!-- Card 4: Active Regressions -->
        <div class="kpi-card" style="--kpi-accent: #f43f5e; cursor: pointer;" onclick="switchTab('triage')">
          <div class="kpi-header">
            <span>Active Regressions</span>
            <span class="badge badge-fail">Action Required</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value" style="color: #fb7185;">\${k.newRegressionCount}</span>
            <span class="kpi-sub">failing on latest run</span>
          </div>
          <div class="kpi-legend">
            <span>🧩 <strong>\${k.recurringFailureGroupCount}</strong> distinct ErrorHash signatures</span>
          </div>
        </div>

        <!-- Card 5: Flaky Test Detection -->
        <div class="kpi-card" style="--kpi-accent: #eab308; cursor: pointer;" onclick="switchTab('triage')">
          <div class="kpi-header">
            <span>Flaky Tests Detected</span>
            <span class="badge badge-flaky">Oscillating</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value" style="color: #fde047;">\${k.flakyTestCount}</span>
            <span class="kpi-sub">toggling Pass/Fail</span>
          </div>
          <div class="kpi-legend">
            <span>🐛 Open Linked Defects: <strong>\${k.openLinkedDefectsCount}</strong> (\${k.defectCoveragePct}% cov)</span>
          </div>
        </div>

        <!-- Card 6: P95 Execution Velocity -->
        <div class="kpi-card" style="--kpi-accent: #a855f7; cursor: pointer;" onclick="switchTab('performance')">
          <div class="kpi-header">
            <span>P95 Duration</span>
            <span class="badge badge-pipeline">Velocity</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value">\${formatDuration(k.p95TestDurationMs)}</span>
            <span class="kpi-sub">P95 test case</span>
          </div>
          <div class="kpi-legend">
            <span>Avg Run: <strong>\${formatDuration(k.avgRunDurationMs)}</strong></span>
            <span>P95 Run: <strong>\${formatDuration(k.p95RunDurationMs)}</strong></span>
          </div>
        </div>
      \`;
    }

    function setTrendMetric(metric) {
      trendMetric = metric;
      document.getElementById('metricToggleTests').classList.toggle('active', metric === 'tests');
      document.getElementById('metricToggleRuns').classList.toggle('active', metric === 'runs');
      renderVolumeTrendChart();
    }

    function renderVolumeTrendChart() {
      const container = document.getElementById('volumeTrendChart');
      const buckets = currentReport.trends.buckets || [];
      if (buckets.length === 0) {
        container.innerHTML = '<div class="empty-state">No execution trend data in selected window.</div>';
        return;
      }

      const width = 720;
      const height = 250;
      const padLeft = 44;
      const padRight = 16;
      const padTop = 22;
      const padBottom = 38;
      const plotW = width - padLeft - padRight;
      const plotH = height - padTop - padBottom;

      const maxVal = Math.max(
        1,
        ...buckets.map(b =>
          trendMetric === 'tests'
            ? b.pipelineTests + b.directAdoTests
            : b.pipelineRuns + b.directAdoRuns
        )
      );

      const barGroupW = plotW / buckets.length;
      const barW = Math.min(28, Math.max(6, barGroupW * 0.62));

      let gridLines = '';
      for (let i = 0; i <= 4; i++) {
        const y = padTop + plotH - (i / 4) * plotH;
        const val = Math.round((i / 4) * maxVal);
        gridLines += \`
          <line x1="\${padLeft}" y1="\${y}" x2="\${width - padRight}" y2="\${y}" stroke="rgba(148,163,184,0.12)" stroke-dasharray="3,3" />
          <text x="\${padLeft - 8}" y="\${y + 4}" text-anchor="end" fill="#64748b" font-size="10">\${val}</text>
        \`;
      }

      const labelStride = Math.max(1, Math.ceil(buckets.length / 10));
      let barsSvg = '';

      buckets.forEach((b, idx) => {
        const pVal = trendMetric === 'tests' ? b.pipelineTests : b.pipelineRuns;
        const dVal = trendMetric === 'tests' ? b.directAdoTests : b.directAdoRuns;
        const pH = (pVal / maxVal) * plotH;
        const dH = (dVal / maxVal) * plotH;

        const x = padLeft + idx * barGroupW + (barGroupW - barW) / 2;
        const yPipeline = padTop + plotH - pH;
        const yDirect = yPipeline - dH;

        barsSvg += \`
          <g>
            <title>\${b.bucketStart}: Azure Pipelines = \${pVal}, Direct in ADO = \${dVal}</title>
            <rect x="\${x}" y="\${yPipeline}" width="\${barW}" height="\${Math.max(0, pH)}" fill="#38bdf8" rx="2" />
            <rect x="\${x}" y="\${yDirect}" width="\${barW}" height="\${Math.max(0, dH)}" fill="#f59e0b" rx="2" />
          </g>
        \`;

        if (idx % labelStride === 0 || idx === buckets.length - 1) {
          barsSvg += \`
            <text x="\${x + barW / 2}" y="\${height - 12}" text-anchor="middle" fill="#94a3b8" font-size="10">\${escapeHtml(b.label)}</text>
          \`;
        }
      });

      container.innerHTML = \`
        <svg viewBox="0 0 \${width} \${height}" style="width: 100%; height: 100%; overflow: visible;">
          <g transform="translate(\${padLeft}, 10)">
            <rect x="0" y="-8" width="10" height="10" rx="2" fill="#38bdf8" />
            <text x="15" y="0" fill="#cbd5e1" font-size="11" font-weight="600">Executed in Azure Pipelines</text>
            <rect x="195" y="-8" width="10" height="10" rx="2" fill="#f59e0b" />
            <text x="210" y="0" fill="#cbd5e1" font-size="11" font-weight="600">Executed Directly in ADO (Manual)</text>
          </g>
          \${gridLines}
          \${barsSvg}
        </svg>
      \`;
    }

    function renderHeadToHeadComparison() {
      const p = currentReport.sourceComparison.pipeline;
      const d = currentReport.sourceComparison.directAdo;

      document.getElementById('headToHeadCards').innerHTML = \`
        <div class="comp-box" style="border-top: 3px solid #38bdf8;">
          <div class="comp-box-header">
            <span class="badge badge-pipeline">🚀 Azure Pipelines (Automated)</span>
            <span style="font-size: 12px; font-weight: 700; color: #38bdf8;">\${p.passRate}% Pass</span>
          </div>
          <div class="comp-stat-grid">
            <div>
              <div class="comp-stat-val">\${p.runs}</div>
              <div class="comp-stat-lbl">Runs</div>
            </div>
            <div>
              <div class="comp-stat-val">\${p.tests}</div>
              <div class="comp-stat-lbl">Executions</div>
            </div>
            <div>
              <div class="comp-stat-val" style="color: #fb7185;">\${p.failed}</div>
              <div class="comp-stat-lbl">Failures</div>
            </div>
            <div>
              <div class="comp-stat-val" style="color: #34d399;">\${p.passed}</div>
              <div class="comp-stat-lbl">Passed</div>
            </div>
            <div>
              <div class="comp-stat-val">\${formatDuration(p.avgTestDurationMs)}</div>
              <div class="comp-stat-lbl">Avg Test</div>
            </div>
            <div>
              <div class="comp-stat-val">\${formatDuration(p.p95TestDurationMs)}</div>
              <div class="comp-stat-lbl">P95 Test</div>
            </div>
          </div>
        </div>

        <div class="comp-box" style="border-top: 3px solid #f59e0b;">
          <div class="comp-box-header">
            <span class="badge badge-direct">🧭 Direct in ADO (Manual)</span>
            <span style="font-size: 12px; font-weight: 700; color: #fbbf24;">\${d.passRate}% Pass</span>
          </div>
          <div class="comp-stat-grid">
            <div>
              <div class="comp-stat-val">\${d.runs}</div>
              <div class="comp-stat-lbl">Runs</div>
            </div>
            <div>
              <div class="comp-stat-val">\${d.tests}</div>
              <div class="comp-stat-lbl">Executions</div>
            </div>
            <div>
              <div class="comp-stat-val" style="color: #fb7185;">\${d.failed}</div>
              <div class="comp-stat-lbl">Failures</div>
            </div>
            <div>
              <div class="comp-stat-val" style="color: #a855f7;">\${d.blocked}</div>
              <div class="comp-stat-lbl">Blocked</div>
            </div>
            <div>
              <div class="comp-stat-val">\${formatDuration(d.avgTestDurationMs)}</div>
              <div class="comp-stat-lbl">Avg Test</div>
            </div>
            <div>
              <div class="comp-stat-val">\${formatDuration(d.p95TestDurationMs)}</div>
              <div class="comp-stat-lbl">P95 Test</div>
            </div>
          </div>
        </div>
      \`;
    }

    function renderPassRateTrendChart() {
      const container = document.getElementById('passRateTrendChart');
      const buckets = (currentReport.trends.buckets || []).filter(
        b => b.pipelineTests + b.directAdoTests > 0
      );
      if (buckets.length === 0) {
        container.innerHTML = '<div class="empty-state">No pass rate points to plot.</div>';
        return;
      }

      const width = 520;
      const height = 145;
      const padL = 36, padR = 14, padT = 18, padB = 26;
      const plotW = width - padL - padR;
      const plotH = height - padT - padB;

      const xFor = (i) => padL + (buckets.length === 1 ? plotW / 2 : (i / (buckets.length - 1)) * plotW);
      const yFor = (pct) => padT + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;

      const pipePts = [];
      const dirPts = [];
      buckets.forEach((b, i) => {
        if (b.pipelineTests > 0) pipePts.push(\`\${xFor(i)},\${yFor(b.pipelinePassRate)}\`);
        if (b.directAdoTests > 0) dirPts.push(\`\${xFor(i)},\${yFor(b.directAdoPassRate)}\`);
      });

      container.innerHTML = \`
        <svg viewBox="0 0 \${width} \${height}" style="width: 100%; height: 100%;">
          <text x="\${padL}" y="11" fill="#94a3b8" font-size="10.5" font-weight="600">Pass Rate Trend (%) — Pipeline (Blue) vs. Direct ADO (Amber)</text>
          <line x1="\${padL}" y1="\${yFor(100)}" x2="\${width - padR}" y2="\${yFor(100)}" stroke="rgba(148,163,184,0.12)" stroke-dasharray="2,2" />
          <text x="\${padL - 6}" y="\${yFor(100) + 3}" text-anchor="end" fill="#64748b" font-size="9.5">100%</text>
          <line x1="\${padL}" y1="\${yFor(50)}" x2="\${width - padR}" y2="\${yFor(50)}" stroke="rgba(148,163,184,0.12)" stroke-dasharray="2,2" />
          <text x="\${padL - 6}" y="\${yFor(50) + 3}" text-anchor="end" fill="#64748b" font-size="9.5">50%</text>
          <line x1="\${padL}" y1="\${yFor(0)}" x2="\${width - padR}" y2="\${yFor(0)}" stroke="rgba(148,163,184,0.12)" />
          \${pipePts.length > 1 ? \`<polyline fill="none" stroke="#38bdf8" stroke-width="2.2" points="\${pipePts.join(' ')}" />\` : ''}
          \${dirPts.length > 1 ? \`<polyline fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-dasharray="4,2" points="\${dirPts.join(' ')}" />\` : ''}
        </svg>
      \`;
    }

    function switchTab(tab) {
      activeTab = tab;
      ['runs', 'triage', 'performance'].forEach(t => {
        document.getElementById('tabBtn-' + t).classList.toggle('active', t === tab);
      });
      renderActiveTab();
    }

    function toggleRunDrawer(runId) {
      if (expandedRunIds.has(runId)) expandedRunIds.delete(runId);
      else expandedRunIds.add(runId);
      renderActiveTab();
    }

    function renderSourceBadge(source, subSource) {
      if (source === 'direct_ado') {
        return '<span class="badge badge-direct">🧭 Direct in ADO · Manual</span>';
      }
      if (subSource === 'ado_test_reporter') {
        return '<span class="badge badge-reporter">🚀 Pipeline · ADO Reporter</span>';
      }
      return '<span class="badge badge-pipeline">⚙️ Pipeline · Standard CI</span>';
    }

    function renderActiveTab() {
      const panel = document.getElementById('tabContentPanel');
      const query = (document.getElementById('searchBox').value || '').trim().toLowerCase();

      if (activeTab === 'runs') {
        renderRunsTab(panel, query);
      } else if (activeTab === 'triage') {
        renderTriageTab(panel, query);
      } else {
        renderPerformanceTab(panel, query);
      }
    }

    function renderRunsTab(panel, query) {
      const runs = (currentReport.runs || []).filter(r => {
        if (!query) return true;
        if (String(r.runId).includes(query)) return true;
        if ((r.name || '').toLowerCase().includes(query)) return true;
        if ((r.planName || '').toLowerCase().includes(query)) return true;
        if ((r.suiteName || '').toLowerCase().includes(query)) return true;
        if ((r.buildNumber || '').toLowerCase().includes(query)) return true;
        return (r.results || []).some(res =>
          (res.testCaseId && String(res.testCaseId).toLowerCase().includes(query)) ||
          (res.testCaseTitle || '').toLowerCase().includes(query)
        );
      });

      if (runs.length === 0) {
        panel.innerHTML = '<div class="empty-state">No test runs match the selected date range and filters.</div>';
        return;
      }

      let rowsHtml = '';
      for (const r of runs) {
        const isExpanded = expandedRunIds.has(r.runId);
        const passPct = r.totalTests > 0 ? (r.passedTests / r.totalTests) * 100 : 0;
        const failPct = r.totalTests > 0 ? (r.failedTests / r.totalTests) * 100 : 0;
        const otherPct = Math.max(0, 100 - passPct - failPct);

        rowsHtml += \`
          <tr class="run-row" onclick="toggleRunDrawer(\${r.runId})">
            <td class="mono">#\${r.runId}</td>
            <td>
              <div style="font-weight: 600;">\${isExpanded ? '▼' : '▶'} \${escapeHtml(r.name)}</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">
                \${escapeHtml(r.planName || 'Unassigned Plan')} \${r.suiteName ? '› ' + escapeHtml(r.suiteName) : ''}
              </div>
            </td>
            <td>\${renderSourceBadge(r.executionSource, r.executionSubSource)}</td>
            <td class="mono">
              \${r.buildNumber
                ? (r.buildUrl
                    ? \`<a href="\${escapeHtml(r.buildUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Build \${escapeHtml(r.buildNumber)} ↗</a>\`
                    : escapeHtml(r.buildNumber))
                : '<span style="color: var(--text-muted);">Direct / No Build</span>'}
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: \${r.failedTests > 0 ? '#fb7185' : '#34d399'};">\${r.passRate}%</span>
                <span style="font-size: 11.5px; color: var(--text-secondary);">
                  (\${r.passedTests}P / \${r.failedTests}F\${r.blockedTests ? ' / ' + r.blockedTests + 'B' : ''})
                </span>
              </div>
              <div class="progress-mini">
                <div class="progress-pass" style="width: \${passPct}%"></div>
                <div class="progress-fail" style="width: \${failPct}%"></div>
                <div class="progress-other" style="width: \${otherPct}%"></div>
              </div>
            </td>
            <td class="mono">\${formatDuration(r.durationMs)}</td>
            <td style="font-size: 12px; color: var(--text-secondary);">\${formatDateShort(r.completedDate)}</td>
            <td>
              <a class="btn" style="padding: 4px 9px; font-size: 11.5px;" href="\${escapeHtml(r.runUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
                Open Run ↗
              </a>
            </td>
          </tr>
        \`;

        if (isExpanded) {
          const resRows = (r.results || []).map(res => {
            const outBadge =
              res.outcome === 'Passed'
                ? '<span class="badge badge-pass">Passed</span>'
                : res.outcome === 'Failed'
                ? '<span class="badge badge-fail">Failed</span>'
                : '<span class="badge badge-flaky">' + escapeHtml(res.outcome) + '</span>';

            const tcLink = res.testCaseId
              ? \`<a class="mono" href="\${escapeHtml(res.testCaseUrl || '#')}" target="_blank" rel="noopener noreferrer">TC\${escapeHtml(res.testCaseId)} ↗</a>\`
              : '<span class="mono" style="color: var(--text-muted);">Unlinked</span>';

            const defectCell = res.linkedDefect
              ? \`<a class="badge \${res.linkedDefect.isFlakyTagged ? 'badge-flaky' : 'badge-fail'}" href="\${escapeHtml(res.linkedDefect.url)}" target="_blank" rel="noopener noreferrer">
                  🐛 #\${res.linkedDefect.workItemId} (\${escapeHtml(res.linkedDefect.state)}) ↗
                </a>\`
              : '<span style="color: var(--text-muted); font-size: 11.5px;">—</span>';

            return \`
              <tr>
                <td>\${tcLink}</td>
                <td style="font-weight: 500;">\${escapeHtml(res.testCaseTitle)}</td>
                <td>\${outBadge}</td>
                <td class="mono">\${formatDuration(res.durationMs)}</td>
                <td>\${defectCell}</td>
                <td>\${res.errorMessage ? '<div class="error-box" title="' + escapeHtml(res.errorMessage) + '">' + escapeHtml(res.errorMessage) + '</div>' : '—'}</td>
              </tr>
            \`;
          }).join('');

          rowsHtml += \`
            <tr class="drawer-row">
              <td colspan="8">
                <div class="drawer-content">
                  <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px; color: #38bdf8;">
                    Test Case Executions in Run #\${r.runId} (\${(r.results || []).length} results)
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Test Case</th>
                        <th>Test Name</th>
                        <th>Outcome</th>
                        <th>Duration</th>
                        <th>Linked ADO Defect</th>
                        <th>Error Details</th>
                      </tr>
                    </thead>
                    <tbody>\${resRows || '<tr><td colspan="6">No granular test results recorded.</td></tr>'}</tbody>
                  </table>
                </div>
              </td>
            </tr>
          \`;
        }
      }

      panel.innerHTML = \`
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Run Name &amp; Plan / Suite</th>
                <th>Execution Source</th>
                <th>Build</th>
                <th>Outcome Summary</th>
                <th>Duration</th>
                <th>Completed</th>
                <th>Quick Action</th>
              </tr>
            </thead>
            <tbody>\${rowsHtml}</tbody>
          </table>
        </div>
      \`;
    }

    function renderTriageTab(panel, query) {
      const regressions = (currentReport.triage.newRegressions || []).filter(r =>
        !query ||
        r.testCaseTitle.toLowerCase().includes(query) ||
        String(r.testCaseId).toLowerCase().includes(query) ||
        (r.errorMessage || '').toLowerCase().includes(query)
      );

      const flaky = (currentReport.triage.flakyTests || []).filter(f =>
        !query ||
        f.testCaseTitle.toLowerCase().includes(query) ||
        String(f.testCaseId || '').toLowerCase().includes(query)
      );

      const recurring = (currentReport.triage.recurringFailures || []).filter(g =>
        !query ||
        g.errorSnippet.toLowerCase().includes(query) ||
        g.affectedTestTitles.some(t => t.toLowerCase().includes(query))
      );

      const regRows = regressions.map(reg => \`
        <tr>
          <td>
            \${reg.testCaseId !== 'Unlinked'
              ? \`<a class="mono" href="\${escapeHtml(reg.testCaseUrl || '#')}" target="_blank" rel="noopener noreferrer">TC\${escapeHtml(reg.testCaseId)} ↗</a>\`
              : '<span class="mono">Unlinked</span>'}
          </td>
          <td style="font-weight: 600;">\${escapeHtml(reg.testCaseTitle)}</td>
          <td>\${renderSourceBadge(reg.executionSource, reg.executionSubSource)}</td>
          <td>
            <span class="badge badge-fail">\${reg.consecutiveFailures} consecutive fail\${reg.consecutiveFailures > 1 ? 's' : ''}</span>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Passed \${reg.previousPassedCount}x earlier in window</div>
          </td>
          <td>
            \${reg.linkedDefect
              ? \`<a class="badge badge-fail" href="\${escapeHtml(reg.linkedDefect.url)}" target="_blank" rel="noopener noreferrer">🐛 #\${reg.linkedDefect.workItemId} (\${escapeHtml(reg.linkedDefect.state)}) ↗</a>\`
              : '<span class="badge badge-flaky">⚠️ Unlinked Failure</span>'}
          </td>
          <td>\${reg.errorMessage ? '<div class="error-box" title="' + escapeHtml(reg.errorMessage) + '">' + escapeHtml(reg.errorMessage) + '</div>' : '—'}</td>
          <td>
            <a class="btn" style="padding: 4px 9px; font-size: 11.5px;" href="\${escapeHtml(reg.runUrl)}" target="_blank" rel="noopener noreferrer">
              Run #\${reg.latestRunId} ↗
            </a>
          </td>
        </tr>
      \`).join('');

      const flakyRows = flaky.map(f => {
        const dots = (f.outcomeSequence || []).map(o => {
          const ch = o === 'Passed' ? 'P' : o === 'Failed' ? 'F' : 'O';
          return \`<span class="spark-dot spark-\${ch}" title="\${escapeHtml(o)}">\${ch}</span>\`;
        }).join('');

        return \`
          <tr>
            <td>
              \${f.testCaseId
                ? \`<a class="mono" href="\${escapeHtml(f.testCaseUrl || '#')}" target="_blank" rel="noopener noreferrer">TC\${escapeHtml(f.testCaseId)} ↗</a>\`
                : '—'}
            </td>
            <td style="font-weight: 600;">\${escapeHtml(f.testCaseTitle)}</td>
            <td><div class="spark-seq">\${dots}</div></td>
            <td>
              <span class="badge badge-flaky">\${f.oscillationCount} flips (\${f.flipRatePct}%)</span>
            </td>
            <td class="mono">\${f.passCount}P / \${f.failCount}F</td>
            <td style="font-size: 12px;">
              🚀 \${f.pipelineExecutions} / 🧭 \${f.directAdoExecutions}
            </td>
            <td>
              \${f.linkedDefect
                ? \`<a class="badge badge-flaky" href="\${escapeHtml(f.linkedDefect.url)}" target="_blank" rel="noopener noreferrer">🐛 #\${f.linkedDefect.workItemId} ↗</a>\`
                : '<span style="color: var(--text-muted); font-size: 12px;">No linked task</span>'}
            </td>
          </tr>
        \`;
      }).join('');

      const recRows = recurring.map(g => \`
        <tr>
          <td class="mono" title="\${escapeHtml(g.errorHash)}">\${escapeHtml(g.errorHash.slice(0, 10))}…</td>
          <td><div class="error-box" title="\${escapeHtml(g.errorSnippet)}">\${escapeHtml(g.errorSnippet)}</div></td>
          <td><strong>\${g.occurrences}</strong> occurrences</td>
          <td style="font-size: 12px;">🚀 \${g.pipelineOccurrences} / 🧭 \${g.directAdoOccurrences}</td>
          <td class="mono">\${g.affectedTestCaseIds.map(id => 'TC' + escapeHtml(id)).join(', ') || g.affectedTestTitles.length + ' tests'}</td>
          <td>
            \${g.linkedDefect
              ? \`<a class="badge badge-fail" href="\${escapeHtml(g.linkedDefect.url)}" target="_blank" rel="noopener noreferrer">#\${g.linkedDefect.workItemId} ↗</a>\`
              : '—'}
          </td>
          <td>
            <a class="btn" style="padding: 4px 9px; font-size: 11.5px;" href="\${escapeHtml(g.sampleRunUrl)}" target="_blank" rel="noopener noreferrer">Latest Run ↗</a>
          </td>
        </tr>
      \`).join('');

      panel.innerHTML = \`
        <div class="sub-section-title" style="margin-top: 0;">
          🚨 Active Regressions — Failing on Latest Execution (\${regressions.length})
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Test Case</th>
                <th>Test Title</th>
                <th>Source</th>
                <th>Streak &amp; History</th>
                <th>Linked Defect</th>
                <th>Failure Message</th>
                <th>Latest Run</th>
              </tr>
            </thead>
            <tbody>\${regRows || '<tr><td colspan="7" class="empty-state">🎉 Zero active regressions in the selected window!</td></tr>'}</tbody>
          </table>
        </div>

        <div class="sub-section-title">
          🔁 Flaky Tests — Pass/Fail Oscillations in Window (\${flaky.length})
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Test Case</th>
                <th>Test Title</th>
                <th>Recent Sequence (Old → New)</th>
                <th>Oscillation Rate</th>
                <th>Pass / Fail</th>
                <th>Pipeline / Direct</th>
                <th>Linked Flaky Task</th>
              </tr>
            </thead>
            <tbody>\${flakyRows || '<tr><td colspan="7" class="empty-state">No flaky test oscillations detected in this date range.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="sub-section-title">
          🧩 Recurring Failure Signatures by ErrorHash (\${recurring.length})
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ErrorHash</th>
                <th>Error Signature</th>
                <th>Frequency</th>
                <th>Source Split</th>
                <th>Affected Test Cases</th>
                <th>Defect</th>
                <th>Sample Run</th>
              </tr>
            </thead>
            <tbody>\${recRows || '<tr><td colspan="7" class="empty-state">No recurring failures recorded.</td></tr>'}</tbody>
          </table>
        </div>
      \`;
    }

    function renderPerformanceTab(panel, query) {
      const slowest = (currentReport.triage.slowestTests || []).filter(s =>
        !query ||
        s.testCaseTitle.toLowerCase().includes(query) ||
        String(s.testCaseId || '').toLowerCase().includes(query)
      );
      const suites = currentReport.planSuiteHealth || [];

      const slowRows = slowest.map(s => \`
        <tr>
          <td>
            \${s.testCaseId
              ? \`<a class="mono" href="\${escapeHtml(s.testCaseUrl || '#')}" target="_blank" rel="noopener noreferrer">TC\${escapeHtml(s.testCaseId)} ↗</a>\`
              : '—'}
          </td>
          <td style="font-weight: 600;">\${escapeHtml(s.testCaseTitle)}</td>
          <td>\${renderSourceBadge(s.executionSource, s.executionSubSource)}</td>
          <td class="mono" style="font-weight: 700; color: #fde047;">\${formatDuration(s.p95DurationMs)}</td>
          <td class="mono">\${formatDuration(s.avgDurationMs)}</td>
          <td class="mono">\${formatDuration(s.maxDurationMs)}</td>
          <td class="mono">\${s.executions}</td>
          <td>
            <a class="btn" style="padding: 4px 9px; font-size: 11.5px;" href="\${escapeHtml(s.runUrl)}" target="_blank" rel="noopener noreferrer">Run #\${s.latestRunId} ↗</a>
          </td>
        </tr>
      \`).join('');

      const suiteRows = suites.map(st => \`
        <tr>
          <td style="font-weight: 600;">\${escapeHtml(st.planName)}</td>
          <td>\${escapeHtml(st.suiteName)}</td>
          <td class="mono">\${st.totalRuns} (🚀 \${st.pipelineRuns} / 🧭 \${st.directAdoRuns})</td>
          <td class="mono">\${st.totalTests} (🚀 \${st.pipelineTests} / 🧭 \${st.directAdoTests})</td>
          <td>
            <span class="badge \${st.passRate >= 90 ? 'badge-pass' : st.passRate >= 75 ? 'badge-flaky' : 'badge-fail'}">\${st.passRate}%</span>
          </td>
          <td class="mono" style="color: #fb7185;">\${st.failedTests}</td>
          <td class="mono" style="color: #fde047;">\${st.flakyCount}</td>
        </tr>
      \`).join('');

      panel.innerHTML = \`
        <div class="sub-section-title" style="margin-top: 0;">
          📊 Plan &amp; Suite Quality Matrix (Pipeline vs. Direct ADO Breakdown)
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Test Plan</th>
                <th>Test Suite</th>
                <th>Runs (Pipeline / Direct)</th>
                <th>Tests (Pipeline / Direct)</th>
                <th>Pass Rate</th>
                <th>Failed Executions</th>
                <th>Flaky Tests</th>
              </tr>
            </thead>
            <tbody>\${suiteRows || '<tr><td colspan="7" class="empty-state">No suite data available.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="sub-section-title">
          🐢 Slowest Test Cases Leaderboard (Ranked by P95 Duration)
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Test Case</th>
                <th>Test Title</th>
                <th>Execution Source</th>
                <th>P95 Duration</th>
                <th>Avg Duration</th>
                <th>Max Duration</th>
                <th>Executions</th>
                <th>Sample Run</th>
              </tr>
            </thead>
            <tbody>\${slowRows || '<tr><td colspan="8" class="empty-state">No test duration data available.</td></tr>'}</tbody>
          </table>
        </div>
      \`;
    }

    async function syncFromAdo() {
      const btn = document.getElementById('syncAdoBtn');
      const origText = btn.textContent;
      btn.textContent = '⏳ Syncing ADO...';
      btn.disabled = true;
      try {
        const startDate = document.getElementById('startDateInput').value;
        const endDate = document.getElementById('endDateInput').value;
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, endDate }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast('⚠️ ' + (data.error || 'Sync failed'));
        } else {
          currentReport = data.report;
          allRuns = data.allRuns || currentReport.runs;
          populateDropdowns();
          renderAll();
          showToast('✅ Synced latest runs from Azure DevOps!');
        }
      } catch (e) {
        showToast('⚠️ Could not reach local server to sync: ' + e.message);
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    }

    function generateMarkdownClientSide() {
      const k = currentReport.kpis;
      const f = currentReport.filter;
      const lines = [
        '# 📊 ADO Test Runs Insights & Triage Summary',
        '**Project:** \`' + currentReport.project + '\` | **Window:** \`' + f.startDate + '\` to \`' + f.endDate + '\`',
        '',
        '- **Total Executions:** ' + k.totalTests + ' across ' + k.totalRuns + ' runs',
        '- **Execution Split:** 🚀 Azure Pipelines: **' + k.pipelineTests + '** (' + k.automationSharePct + '%) vs 🧭 Direct in ADO: **' + k.directAdoTests + '** (' + Number((100 - k.automationSharePct).toFixed(1)) + '%)',
        '- **Pass Rate:** **' + k.overallPassRate + '%** (Pipeline: ' + k.pipelinePassRate + '%, Direct ADO: ' + k.directAdoPassRate + '%)',
        '- **Active Regressions:** ' + k.newRegressionCount + ' | **Flaky Tests:** ' + k.flakyTestCount + ' | **Open Linked Defects:** ' + k.openLinkedDefectsCount,
        '',
      ];
      if ((currentReport.triage.newRegressions || []).length > 0) {
        lines.push('### 🚨 Active Regressions');
        for (const r of currentReport.triage.newRegressions.slice(0, 8)) {
          lines.push('- **TC' + r.testCaseId + ' ' + r.testCaseTitle + '** (' + r.consecutiveFailures + 'x fail, ' + r.executionSource + ') — [Run #' + r.latestRunId + '](' + r.runUrl + ')');
        }
      }
      return lines.join('\\n');
    }

    async function copyMarkdownReport() {
      let md = generateMarkdownClientSide();
      if (PAYLOAD.isLiveServer) {
        try {
          const qs = new URLSearchParams(currentReport.filter).toString();
          const res = await fetch('/api/export/markdown?' + qs);
          if (res.ok) md = await res.text();
        } catch (e) {}
      }
      try {
        await navigator.clipboard.writeText(md);
        showToast('📋 Copied Markdown Triage Summary to clipboard!');
      } catch (e) {
        showToast('ℹ️ Markdown generated (clipboard permission unavailable).');
      }
    }

    function sanitizeCsvCellClient(val) {
      if (val === null || val === undefined) return '';
      let s = String(val);
      const trimmed = s.trim();
      if (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('@') || (trimmed.startsWith('-') && trimmed.charAt(1) !== ' ')) {
        s = "'" + s;
      }
      if (/[",\\n\\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    function downloadCsvReport() {
      if (PAYLOAD.isLiveServer) {
        const qs = new URLSearchParams(currentReport.filter).toString();
        window.location.href = '/api/export/csv?' + qs;
        showToast('📥 Downloading CSV report...');
        return;
      }

      const headers = ['RunId','RunName','CompletedDate','ExecutionSource','ExecutionSubSource','PlanName','SuiteName','BuildNumber','TestCaseId','TestCaseTitle','Outcome','DurationMs','LinkedDefectId','RunUrl'];
      const rows = [headers.join(',')];
      for (const r of currentReport.runs || []) {
        for (const res of r.results || []) {
          rows.push([
            r.runId, r.name, res.completedDate || r.completedDate, res.executionSource, res.executionSubSource,
            r.planName || '', r.suiteName || '', r.buildNumber || '', res.testCaseId || '', res.testCaseTitle,
            res.outcome, res.durationMs, res.linkedDefect?.workItemId || '', r.runUrl
          ].map(sanitizeCsvCellClient).join(','));
        }
      }
      const blob = new Blob([rows.join('\\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ado-test-runs-' + currentReport.filter.startDate + '-to-' + currentReport.filter.endDate + '.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('📥 Exported CSV report!');
    }

    function downloadHtmlSnapshot() {
      if (PAYLOAD.isLiveServer) {
        const qs = new URLSearchParams(currentReport.filter).toString();
        window.location.href = '/api/export/html?' + qs;
        showToast('💾 Downloading self-contained HTML snapshot...');
        return;
      }
      const htmlContent = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ado-dashboard-snapshot-' + currentReport.filter.startDate + '-to-' + currentReport.filter.endDate + '.html';
      a.click();
      URL.revokeObjectURL(url);
      showToast('💾 Saved self-contained HTML snapshot!');
    }

    initDashboard();
  </script>
</body>
</html>`;
  }
}
