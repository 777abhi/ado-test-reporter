
import { ILogger } from "./interfaces/ILogger";

export class ConsoleLogger implements ILogger {
    log(message: string): void {
        console.log(message);
    }

    warn(message: string, error?: any): void {
        if (error) {
            console.warn(message, error);
        } else {
            console.warn(message);
        }
    }

    error(message: string, error?: any): void {
        if (error) {
            console.error(message, error);
        } else {
            console.error(message);
        }
    }
}
