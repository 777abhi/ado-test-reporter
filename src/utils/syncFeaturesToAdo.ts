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
                'dry-run': {
                    type: 'boolean',
                    default: false,
                    describe: 'Parse feature files and preview scenarios to sync without calling Azure DevOps',
                },
            })
            .strict()
            .help()
            .alias('h', 'help')
            .parseSync();

        const logger = new ConsoleLogger();
        const parser = new GherkinFeatureParser();
        const featuresPattern = argv.pattern;
        const scenarios = await parser.parse(featuresPattern);

        logger.log(`Parsed ${scenarios.length} scenarios.`);

        const scenariosToSync = scenarios.filter(s => !!s.tcId);
        logger.log(`Found ${scenariosToSync.length} scenarios with @TC_ tags to sync.`);

        if (argv['dry-run']) {
            logger.log(`\n🔍 [DRY RUN] No changes will be made to Azure DevOps.`);
            for (const scenario of scenariosToSync) {
                logger.log(`   - Would sync TC${scenario.tcId}: "${scenario.name}" (${scenario.steps.length} step(s))`);
            }
            return;
        }

        // 1. Config
        const configService = new ConfigService();
        const env = configService.loadEnvironment();

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
