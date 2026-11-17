export type WebhookType = "auto" | "slack" | "teams" | "json";

export interface AlertRegressionItem {
  testName: string;
  testCaseId?: string;
  errorMessage?: string;
}

export interface AlertExpiredQuarantineItem {
  testKey: string;
  testName?: string;
  expiresAt: string;
}

export interface AlertPayload {
  project: string;
  buildNumber?: string;
  branch?: string;
  runId?: number;
  runUrl?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  quarantinedTests: number;
  newRegressions?: AlertRegressionItem[];
  expiredQuarantines?: AlertExpiredQuarantineItem[];
}

export interface NotificationOptions {
  webhookUrl: string;
  webhookType?: WebhookType;
  always?: boolean;
  failOnError?: boolean;
}

export interface INotificationService {
  shouldNotify(payload: AlertPayload, always?: boolean): boolean;
  notify(payload: AlertPayload, options: NotificationOptions): Promise<boolean>;
}
