import * as http from "http";
import { URL } from "url";
import {
  DashboardFilterOptions,
  IDashboardCacheRepository,
  IDashboardService,
} from "./interfaces/IDashboardService";
import { ILogger } from "./interfaces/ILogger";
import { DashboardHtmlGenerator } from "./DashboardHtmlGenerator";
import { SecretRedactor } from "./utils/SecretRedactor";
import { IQuarantineService } from "./interfaces/IQuarantineService";
import { QuarantineService } from "./QuarantineService";

export class DashboardServer {
  private server?: http.Server;
  private quarantineService: IQuarantineService;

  constructor(
    private dashboardService: IDashboardService,
    private cacheRepo: IDashboardCacheRepository,
    private logger: ILogger,
    private port: number = 4200,
    private host: string = "127.0.0.1",
    quarantineService?: IQuarantineService
  ) {
    this.quarantineService = quarantineService || new QuarantineService(this.logger);
  }

  private extractFilterFromSearchParams(
    params: URLSearchParams
  ): DashboardFilterOptions {
    return {
      startDate: params.get("startDate") || undefined,
      endDate: params.get("endDate") || undefined,
      planName: params.get("planName") || undefined,
      buildNumber: params.get("buildNumber") || undefined,
      executionSource: (params.get("executionSource") as any) || undefined,
      executionSubSource:
        (params.get("executionSubSource") as any) || undefined,
    };
  }

  start(initialFilter?: DashboardFilterOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(
            req.url || "/",
            `http://${req.headers.host || `${this.host}:${this.port}`}`
          );
          const pathname = reqUrl.pathname;

          if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
            const filter = {
              ...initialFilter,
              ...this.extractFilterFromSearchParams(reqUrl.searchParams),
            };
            const report = this.dashboardService.buildReport(filter);
            const cacheData = this.cacheRepo.load();
            const html = DashboardHtmlGenerator.generateHtml(report, cacheData, {
              isLiveServer: true,
            });
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(html);
            return;
          }

          if (req.method === "GET" && pathname === "/api/report") {
            const filter = this.extractFilterFromSearchParams(
              reqUrl.searchParams
            );
            const report = this.dashboardService.buildReport(filter);
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(report));
            return;
          }

          if (req.method === "POST" && pathname === "/api/sync") {
            const body = await this.readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            const end = parsed.endDate
              ? new Date(`${parsed.endDate}T23:59:59.999Z`)
              : new Date();
            const start = parsed.startDate
              ? new Date(`${parsed.startDate}T00:00:00.000Z`)
              : new Date(end.getTime() - 30 * 86400000);

            const updatedCache = await this.dashboardService.syncFromAdo(
              start,
              end
            );
            const report = this.dashboardService.buildReport({
              startDate: parsed.startDate,
              endDate: parsed.endDate,
            });

            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              JSON.stringify({
                report,
                allRuns: updatedCache.runs,
              })
            );
            return;
          }

          if (req.method === "GET" && pathname === "/api/export/csv") {
            const filter = this.extractFilterFromSearchParams(
              reqUrl.searchParams
            );
            const report = this.dashboardService.buildReport(filter);
            const csv = this.dashboardService.exportToCsv(report);
            const filename = `ado-test-runs-${report.filter.startDate}-to-${report.filter.endDate}.csv`;
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${filename}"`,
            });
            res.end(csv);
            return;
          }

          if (req.method === "GET" && pathname === "/api/export/markdown") {
            const filter = this.extractFilterFromSearchParams(
              reqUrl.searchParams
            );
            const report = this.dashboardService.buildReport(filter);
            const md = this.dashboardService.exportToMarkdown(report);
            res.writeHead(200, {
              "Content-Type": "text/markdown; charset=utf-8",
            });
            res.end(md);
            return;
          }

          if (req.method === "GET" && pathname === "/api/export/html") {
            const filter = this.extractFilterFromSearchParams(
              reqUrl.searchParams
            );
            const report = this.dashboardService.buildReport(filter);
            const cacheData = this.cacheRepo.load();
            const html = DashboardHtmlGenerator.generateHtml(report, cacheData, {
              isLiveServer: false,
            });
            const filename = `ado-dashboard-snapshot-${report.filter.startDate}-to-${report.filter.endDate}.html`;
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Disposition": `attachment; filename="${filename}"`,
            });
            res.end(html);
            return;
          }

          if (req.method === "GET" && pathname === "/api/quarantine") {
            const active = this.quarantineService.listActiveQuarantined();
            const candidates = this.quarantineService.getGraduationCandidates();
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(JSON.stringify({ active, candidates }));
            return;
          }

          if (req.method === "POST" && pathname === "/api/quarantine/add") {
            const body = await this.readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            if (!parsed.title || !parsed.reason) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ error: "Missing required fields: title, reason" })
              );
              return;
            }
            const record = this.quarantineService.quarantineTest({
              testCaseId: parsed.id,
              testCaseTitle: parsed.title,
              reason: parsed.reason,
              healingThreshold: parsed.threshold ? Number(parsed.threshold) : undefined,
              quarantinedBy: parsed.by || "dashboard-lead",
              notes: parsed.notes,
            });
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify({ success: true, record }));
            return;
          }

          if (req.method === "POST" && pathname === "/api/quarantine/remove") {
            const body = await this.readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            if (!parsed.id) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing required field: id" }));
              return;
            }
            const ok = this.quarantineService.unquarantineTest(
              parsed.id,
              parsed.reason
            );
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify({ success: ok }));
            return;
          }

          if (req.method === "POST" && pathname === "/api/quarantine/graduate") {
            const body = await this.readRequestBody(req);
            const parsed = body ? JSON.parse(body) : {};
            if (!parsed.id) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing required field: id" }));
              return;
            }
            const ok = this.quarantineService.graduateTest(
              parsed.id,
              parsed.notes
            );
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify({ success: ok }));
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (err) {
          const safeErr = SecretRedactor.redact((err as Error).message || String(err));
          this.logger.error(`Dashboard server error: ${safeErr}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: safeErr }));
        }
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        this.logger.log(`🌐 ADO Test Runs Insights Dashboard listening at ${url}`);
        resolve(url);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 2 * 1024 * 1024) {
          reject(new Error("Request payload too large"));
        }
      });
      req.on("end", () => resolve(data));
      req.on("error", (err) => reject(err));
    });
  }
}
