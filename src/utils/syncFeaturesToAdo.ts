import yargsFactory from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { ConfigService } from '../config';
import { AzureClientProvider } from '../AzureClientProvider';
import { GherkinFeatureParser } from '../GherkinFeatureParser';
import { AdoSyncService } from '../AdoSyncService';
import { GherkinStepConverter } from '../GherkinStepConverter';
import { TestCaseService } from '../testCaseService';
import { ConsoleLogger } from '../ConsoleLogger';
import { SecretRedactor } from '../utils/SecretRedactor';

async function main() {
    try {
        const argv = yargsFactory(hideBin(process.argv))
            .scriptName('ado-test-reporter sync-features')
            .options({
                pattern: {
                    type: 'string',
                    default: 'features/**/*.feature',
                    describe: 'Glob pattern for Gherkin .feature files',
                },
            })
            .strict()
            .help()
            .alias('h', 'help')
            .parseSync();

        // 1. Config
        const configService = new ConfigService();
        const env = configService.loadEnvironment();
        const logger = new ConsoleLogger();

        // 2. ADO Clients
        const azureClientProvider = new AzureClientProvider();
        const clients = await azureClientProvider.createClients(
            env.token,
            env.orgUrl,
            env.authType,
            logger,
            {
                maxRetries: env.maxRetries,
                baseDelayMs: env.retryBaseDelayMs,
            }
        );
        const witApi = clients.workItemApi;

        // 3. Services
        const parser = new GherkinFeatureParser();
        const stepConverter = new GherkinStepConverter();

        // Instantiate TestCaseService
        const testCaseService = new TestCaseService(
            witApi,
            env.project,
            env.fallbackToNameSearch,
            env.autoCreateTestCases,
            logger
        );

        const adoSyncService = new AdoSyncService(testCaseService, stepConverter);

        // 4. Run
        const featuresPattern = argv.pattern;
        const scenarios = await parser.parse(featuresPattern);

        logger.log(`Parsed ${scenarios.length} scenarios.`);

        const scenariosToSync = scenarios.filter(s => !!s.tcId);
        logger.log(`Found ${scenariosToSync.length} scenarios with @TC_ tags to sync.`);

        for (const scenario of scenariosToSync) {
            await adoSyncService.updateTestCase(scenario);
        }

        logger.log("Feature sync completed.");

    } catch (err) {
        const errorStr = typeof err === 'string' ? err : ((err as Error).message || JSON.stringify(err));
        console.error("Error during sync:", SecretRedactor.redact(errorStr));
        process.exit(1);
    }
}

main();
