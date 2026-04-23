import * as fs from "fs";
import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import * as dotenv from "dotenv";
import * as azureDevOps from "azure-devops-node-api";
import { ConsoleLogger } from "../ConsoleLogger";
import { SecretRedactor } from "./SecretRedactor";

dotenv.config();

async function run() {
  const logger = new ConsoleLogger();

  const argv = yargsFactory(hideBin(process.argv))
    .options({
      "group-name": {
        type: "string",
        demandOption: true,
        describe: "Name of the Azure DevOps Variable Group",
      },
      "project": {
        type: "string",
        demandOption: false,
        default: process.env.ADO_PROJECT,
        describe: "Azure DevOps Project Name",
      },
      "org-url": {
        type: "string",
        demandOption: false,
        default: process.env.ADO_ORG_URL,
        describe: "Azure DevOps Organization URL",
      },
      "token": {
        type: "string",
        demandOption: false,
        default: process.env.ADO_TOKEN,
        describe: "Azure DevOps Personal Access Token (PAT)",
      },
    })
    .help()
    .parseSync();

  const groupName = argv["group-name"];
  const project = argv.project;
  const orgUrl = argv["org-url"];
  const token = argv.token;

  if (!project || !orgUrl || !token) {
    logger.error("Missing required Azure DevOps configuration (Project, Org URL, or Token).");
    process.exit(1);
  }

  logger.log(`Fetching Variable Group '${groupName}' from project '${project}'...`);

  try {
    const authHandler = azureDevOps.getPersonalAccessTokenHandler(token);
    const connection = new azureDevOps.WebApi(orgUrl, authHandler);
    const taskAgentApi = await connection.getTaskAgentApi();

    const variableGroups = await taskAgentApi.getVariableGroups(project, groupName);

    if (!variableGroups || variableGroups.length === 0) {
      logger.error(`Variable group '${groupName}' not found in project '${project}'.`);
      process.exit(1);
    }

    // TaskAgentApi.getVariableGroups does a substring match, so we must find the exact match.
    const exactGroup = variableGroups.find(g => g.name === groupName);

    if (!exactGroup) {
      logger.error(`Variable group '${groupName}' not found in project '${project}'. Found similar: ${variableGroups.map(g => g.name).join(', ')}`);
      process.exit(1);
    }

    if (!exactGroup.variables) {
      logger.warn(`Variable group '${groupName}' contains no variables.`);
      process.exit(0);
    }

    const outputFileName = `.env.${groupName}.latest`;
    const outputPath = path.resolve(process.cwd(), outputFileName);

    let envContent = "";
    for (const [key, variableValue] of Object.entries(exactGroup.variables)) {
      // variableValue type has value?: string, isSecret?: boolean
      const val = variableValue.value || "";
      // Escape newlines and quotes if needed for .env format
      let formattedVal = val;
      if (formattedVal.includes('\n') || formattedVal.includes('"') || formattedVal.includes("'")) {
        // Simple escaping for .env
        formattedVal = `"${formattedVal.replace(/"/g, '\\"')}"`;
      }
      envContent += `${key}=${formattedVal}\n`;
    }

    fs.writeFileSync(outputPath, envContent, "utf-8");
    logger.log(`Successfully wrote ${Object.keys(exactGroup.variables).length} variables to ${outputFileName}`);
  } catch (error: any) {
    const errorStr = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
    logger.error(`Error fetching variable group: ${SecretRedactor.redact(errorStr)}`);
    process.exit(1);
  }
}

run();
