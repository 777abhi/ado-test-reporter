
export interface ILogger {
    log(message: string): void;
    warn(message: string, error?: any): void;
    error(message: string, error?: any): void;
}
