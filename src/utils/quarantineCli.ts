import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConsoleLogger } from "../ConsoleLogger";
import { QuarantineService } from "../QuarantineService";

async function main() {
  const logger = new ConsoleLogger();
  const quarantineService = new QuarantineService(logger);

  const argv = await yargsFactory(hideBin(process.argv))
    .scriptName("quarantine")
    .usage("$0 <cmd> [args]")
    .command("list", "List all actively quarantined tests", (yargs) => {
      return yargs.option("all", {
        type: "boolean",
        default: false,
        describe: "Include graduated and removed tests",
      });
    })
    .command("add", "Add a test to quarantine (soft-pass mode)", (yargs) => {
      return yargs
        .option("id", {
          type: "string",
          describe: "ADO Test Case ID (e.g. 1015 or TC1015)",
        })
        .option("title", {
          type: "string",
          demandOption: true,
          describe: "Test case title or scenario name",
        })
        .option("reason", {
          type: "string",
          demandOption: true,
          describe: "Reason for quarantine",
        })
        .option("threshold", {
          type: "number",
          default: 5,
          describe: "Consecutive passes required for graduation",
        })
        .option("by", {
          type: "string",
          default: process.env.USER || "qa-lead",
          describe: "Author / QA lead approving quarantine",
        })
        .option("notes", {
          type: "string",
          describe: "Additional context or linked defect URL",
        });
    })
    .command("remove", "Remove a test from quarantine", (yargs) => {
      return yargs
        .option("id", {
          type: "string",
          demandOption: true,
          describe: "Test Case ID or testKey to unquarantine",
        })
        .option("reason", {
          type: "string",
          describe: "Reason for removing quarantine",
        });
    })
    .command("graduate", "Approve graduation of a healed test", (yargs) => {
      return yargs
        .option("id", {
          type: "string",
          demandOption: true,
          describe: "Test Case ID or testKey to graduate",
        })
        .option("notes", {
          type: "string",
          describe: "Graduation verification notes",
        });
    })
    .command("candidates", "List quarantined tests ready for graduation", () => {})
    .demandCommand(1, "Please specify a quarantine command: list, add, remove, graduate, or candidates")
    .help()
    .argv;

  const command = argv._[0] as string;

  switch (command) {
    case "list": {
      const config = quarantineService.load();
      const records = argv.all
        ? config.quarantinedTests
        : quarantineService.listActiveQuarantined();

      console.log(`\n🛡️  Quarantined Tests (${records.length} records, file: ${quarantineService.getConfigFilePath()}):\n`);
      if (records.length === 0) {
        console.log("   (No quarantined tests found.)\n");
        return;
      }

      for (const t of records) {
        const idStr = t.testCaseId ? `TC${t.testCaseId}` : t.testKey;
        const statusBadge =
          t.status === "active"
            ? (t.consecutivePasses >= t.healingThreshold ? "🟢 READY TO GRADUATE" : "🟡 ACTIVE")
            : t.status === "graduated"
            ? "🎓 GRADUATED"
            : "⚪ REMOVED";

        console.log(`- [${statusBadge}] ${idStr} - "${t.testCaseTitle}"`);
        console.log(`  Streak: ${t.consecutivePasses}/${t.healingThreshold} passes | Reason: ${t.reason}`);
        console.log(`  Quarantined by: ${t.quarantinedBy || "unknown"} on ${t.quarantinedAt}`);
        if (t.lastObservedAt) {
          console.log(`  Last observed: ${t.lastObservedAt} (Outcome: ${t.lastOutcome || "N/A"})`);
        }
        if (t.notes) {
          console.log(`  Notes: ${t.notes}`);
        }
        console.log("");
      }
      break;
    }

    case "add": {
      const record = quarantineService.quarantineTest({
        testCaseId: argv.id as string | undefined,
        testCaseTitle: argv.title as string,
        reason: argv.reason as string,
        healingThreshold: argv.threshold as number,
        quarantinedBy: argv.by as string,
        notes: argv.notes as string | undefined,
      });

      console.log(`\n✅ Successfully quarantined: "${record.testCaseTitle}" [${record.testKey}]`);
      console.log(`   Healing threshold: ${record.healingThreshold} consecutive passes before graduation recommendation.`);
      console.log(`   Quarantine registry updated at: ${quarantineService.getConfigFilePath()}\n`);
      break;
    }

    case "remove": {
      const ok = quarantineService.unquarantineTest(argv.id as string, argv.reason as string | undefined);
      if (!ok) {
        process.exit(1);
      }
      console.log(`\n✅ Successfully removed '${argv.id}' from active quarantine.\n`);
      break;
    }

    case "graduate": {
      const ok = quarantineService.graduateTest(argv.id as string, argv.notes as string | undefined);
      if (!ok) {
        process.exit(1);
      }
      console.log(`\n🎓 Successfully approved graduation for '${argv.id}'!\n`);
      break;
    }

    case "candidates": {
      const candidates = quarantineService.getGraduationCandidates();
      console.log(`\n🎓 Graduation Candidates (${candidates.length} tests ready for graduation):\n`);
      if (candidates.length === 0) {
        console.log("   (No quarantined tests currently meet the graduation threshold.)\n");
        return;
      }

      for (const c of candidates) {
        const idStr = c.test.testCaseId ? `TC${c.test.testCaseId}` : c.test.testKey;
        console.log(`- 🟢 ${idStr} - "${c.test.testCaseTitle}"`);
        console.log(`  Passing streak: ${c.consecutivePasses}/${c.healingThreshold} consecutive clean runs`);
        console.log(`  To graduate run: npm run quarantine -- graduate --id ${idStr}\n`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Quarantine CLI Error:", err);
  process.exit(1);
});
