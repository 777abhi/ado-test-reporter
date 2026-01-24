import { ConfigService } from '../config';
import { AzureClientProvider } from '../AzureClientProvider';
import { GherkinFeatureParser } from '../GherkinFeatureParser';
import { AdoSyncService } from '../AdoSyncService';

async function main() {
    try {
        // 1. Config
        const configService = new ConfigService();
        const env = configService.loadEnvironment();

        // 2. ADO Clients
        const azureClientProvider = new AzureClientProvider();
        const clients = await azureClientProvider.createClients(env.token, env.orgUrl);
        const witApi = clients.workItemApi;

        // 3. Services
        const parser = new GherkinFeatureParser();
        const adoSyncService = new AdoSyncService(witApi, env.project);

        // 4. Run
        const featuresPattern = 'features/**/*.feature';
        const scenarios = await parser.parse(featuresPattern);

        console.log(`Parsed ${scenarios.length} scenarios.`);
        
        const scenariosToSync = scenarios.filter(s => !!s.tcId);
        console.log(`Found ${scenariosToSync.length} scenarios with @TC_ tags to sync.`);

        for (const scenario of scenariosToSync) {
            await adoSyncService.updateTestCase(scenario);
        }

        console.log("Feature sync completed.");

    } catch (err) {
        console.error("Error during sync:", err);
        process.exit(1);
    }
}

main();
