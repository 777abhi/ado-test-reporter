import { resolveCliDispatch } from "../src/cli";

describe("CLI Unified Router", () => {
  test("routes explicit subcommands and strips subcommand from forwarded args", () => {
    expect(resolveCliDispatch(["publish", "--junit-file", "r.xml"])).toEqual({
      action: "run",
      command: "publish",
      modulePath: "./index",
      forwardedArgs: ["--junit-file", "r.xml"],
    });

    expect(resolveCliDispatch(["dashboard", "--mode", "export", "--days", "7"])).toEqual({
      action: "run",
      command: "dashboard",
      modulePath: "./utils/runDashboard",
      forwardedArgs: ["--mode", "export", "--days", "7"],
    });

    expect(resolveCliDispatch(["pr-gate", "--pr-id", "42"])).toEqual({
      action: "run",
      command: "pr-gate",
      modulePath: "./utils/prGateCli",
      forwardedArgs: ["--pr-id", "42"],
    });

    expect(resolveCliDispatch(["quarantine", "list"])).toEqual({
      action: "run",
      command: "quarantine",
      modulePath: "./utils/quarantineCli",
      forwardedArgs: ["list"],
    });

    expect(resolveCliDispatch(["sync-features", "--pattern", "features/**/*.feature"])).toEqual({
      action: "run",
      command: "sync-features",
      modulePath: "./utils/syncFeaturesToAdo",
      forwardedArgs: ["--pattern", "features/**/*.feature"],
    });

    expect(resolveCliDispatch(["import-excel", "--file", "cases.xlsx"])).toEqual({
      action: "run",
      command: "import-excel",
      modulePath: "./utils/importExcel",
      forwardedArgs: ["--file", "cases.xlsx"],
    });

    expect(resolveCliDispatch(["fetch-variable-group", "--group-name", "QA"])).toEqual({
      action: "run",
      command: "fetch-variable-group",
      modulePath: "./utils/fetchVariableGroup",
      forwardedArgs: ["--group-name", "QA"],
    });
  });

  test("falls back to publish when no subcommand is given", () => {
    expect(resolveCliDispatch([])).toEqual({
      action: "run",
      command: "publish",
      modulePath: "./index",
      forwardedArgs: [],
    });

    expect(resolveCliDispatch(["--junit-file", "src/results.xml", "--attach-results"])).toEqual({
      action: "run",
      command: "publish",
      modulePath: "./index",
      forwardedArgs: ["--junit-file", "src/results.xml", "--attach-results"],
    });
  });

  test("handles --help, -h, help, --version, -v", () => {
    expect(resolveCliDispatch(["--help"]).action).toBe("help");
    expect(resolveCliDispatch(["-h"]).action).toBe("help");
    expect(resolveCliDispatch(["help"]).action).toBe("help");
    expect(resolveCliDispatch(["--version"]).action).toBe("version");
    expect(resolveCliDispatch(["-v"]).action).toBe("version");
  });
});
