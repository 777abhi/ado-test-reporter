
import { ILogger } from "./interfaces/ILogger";
import { SecretRedactor } from "./utils/SecretRedactor";

export class ConsoleLogger implements ILogger {
    log(message: string): void {
        console.log(SecretRedactor.redact(message));
    }

    warn(message: string, error?: any): void {
        const redactedMessage = SecretRedactor.redact(message);
        if (error) {
            const errorStr = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
            console.warn(redactedMessage, SecretRedactor.redact(errorStr));
        } else {
            console.warn(redactedMessage);
        }
    }

    error(message: string, error?: any): void {
        const redactedMessage = SecretRedactor.redact(message);
        if (error) {
            const errorStr = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
            console.error(redactedMessage, SecretRedactor.redact(errorStr));
        } else {
            console.error(redactedMessage);
        }
    }
}
