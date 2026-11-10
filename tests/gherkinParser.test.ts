import * as fs from "fs";
import * as path from "path";
import { GherkinFeatureParser } from "../src/GherkinFeatureParser";

describe("GherkinFeatureParser Limits & Parsing", () => {
  const largeFilePath = path.resolve(__dirname, "temp_large.feature");
  const smallFilePath = path.resolve(__dirname, "temp_small.feature");

  function createLargeFile() {
    const fd = fs.openSync(largeFilePath, "w");
    const size = 51 * 1024 * 1024;
    fs.writeSync(fd, Buffer.from([0]), 0, 1, size - 1);
    fs.closeSync(fd);
  }

  afterEach(() => {
    if (fs.existsSync(largeFilePath)) fs.unlinkSync(largeFilePath);
    if (fs.existsSync(smallFilePath)) fs.unlinkSync(smallFilePath);
  });

  it("should reject feature files exceeding the 50MB limit", async () => {
    const parser = new GherkinFeatureParser();
    createLargeFile();

    await expect(parser.parse(largeFilePath)).rejects.toThrow(/too large/);
  });

  it("should successfully parse valid small feature files", async () => {
    const parser = new GherkinFeatureParser();
    fs.writeFileSync(smallFilePath, "Feature: Small\n  Scenario: Test\n    Given a step");

    const scenarios = await parser.parse(smallFilePath);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0].name).toBe("Test");
  });
});
