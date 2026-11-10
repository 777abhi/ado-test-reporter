import * as fs from "fs";
import * as path from "path";
import { ExcelParser } from "../src/ExcelParser";

describe("ExcelParser Limits & Validation", () => {
  const LARGE_FILE_PATH = path.resolve(__dirname, "temp_large_excel.xlsx");
  const DIR_PATH = path.resolve(__dirname, "temp_dir");

  function createLargeFile() {
    const fd = fs.openSync(LARGE_FILE_PATH, "w");
    const size = 51 * 1024 * 1024;
    fs.writeSync(fd, Buffer.from([0]), 0, 1, size - 1);
    fs.closeSync(fd);
  }

  afterEach(() => {
    if (fs.existsSync(DIR_PATH)) fs.rmdirSync(DIR_PATH);
    if (fs.existsSync(LARGE_FILE_PATH)) fs.unlinkSync(LARGE_FILE_PATH);
  });

  it("should reject parsing directory paths", () => {
    const parser = new ExcelParser();
    if (!fs.existsSync(DIR_PATH)) fs.mkdirSync(DIR_PATH);

    expect(() => {
      parser.parse(DIR_PATH);
    }).toThrow();
  });

  it("should reject files exceeding the 50MB size limit", () => {
    const parser = new ExcelParser();
    createLargeFile();

    expect(() => {
      parser.parse(LARGE_FILE_PATH);
    }).toThrow(/too large/);
  });
});
