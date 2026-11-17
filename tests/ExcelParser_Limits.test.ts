import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import { ExcelParser } from "../src/ExcelParser";

describe("ExcelParser Limits & Validation", () => {
  const LARGE_FILE_PATH = path.resolve(__dirname, "temp_large_excel.xlsx");
  const VALID_FILE_PATH = path.resolve(__dirname, "temp_valid_excel.xlsx");
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
    if (fs.existsSync(VALID_FILE_PATH)) fs.unlinkSync(VALID_FILE_PATH);
  });

  it("should reject parsing directory paths", async () => {
    const parser = new ExcelParser();
    if (!fs.existsSync(DIR_PATH)) fs.mkdirSync(DIR_PATH);

    await expect(parser.parse(DIR_PATH)).rejects.toThrow(/not a file/);
  });

  it("should reject files exceeding the 50MB size limit", async () => {
    const parser = new ExcelParser();
    createLargeFile();

    await expect(parser.parse(LARGE_FILE_PATH)).rejects.toThrow(/too large/);
  });

  it("should parse valid xlsx files into header-keyed row objects", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TestCases");
    ws.addRow(["ID", "Title", "Steps"]);
    ws.addRow([101, "Login Test", "1. Open login"]);
    ws.addRow([102, "Cart Test", "1. Add item"]);
    await wb.xlsx.writeFile(VALID_FILE_PATH);

    const parser = new ExcelParser();
    const rows = await parser.parse(VALID_FILE_PATH);

    expect(rows).toEqual([
      { ID: 101, Title: "Login Test", Steps: "1. Open login" },
      { ID: 102, Title: "Cart Test", Steps: "1. Add item" },
    ]);
  });
});
