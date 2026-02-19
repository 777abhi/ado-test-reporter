import * as fs from 'fs';
import * as assert from 'assert';
import * as path from 'path';
import { ExcelParser } from '../src/ExcelParser';

const LARGE_FILE_PATH = path.resolve(__dirname, 'temp_large_excel.xlsx');
const DIR_PATH = path.resolve(__dirname, 'temp_dir');

// Create 51MB file using fs (sparse if supported, but logical size is what matters)
function createLargeFile() {
    const fd = fs.openSync(LARGE_FILE_PATH, 'w');
    const size = 51 * 1024 * 1024;
    // Write a byte at the end to set logical size
    fs.writeSync(fd, Buffer.from([0]), 0, 1, size - 1);
    fs.closeSync(fd);
}

async function testLimits() {
    const parser = new ExcelParser();

    console.log("---------------------------------------------------");
    console.log("Running ExcelParser Security Tests");
    console.log("---------------------------------------------------");

    // 1. Test Directory
    try {
        if (!fs.existsSync(DIR_PATH)) fs.mkdirSync(DIR_PATH);
        console.log(`[TEST] Parsing directory path: ${DIR_PATH}`);
        parser.parse(DIR_PATH);
        throw new Error("FAIL: Should have thrown error for directory path.");
    } catch (e: any) {
        if (e.message.includes("is not a file")) {
             console.log("✅ PASS: Directory correctly rejected.");
        } else if (e.code === 'EISDIR') {
             console.log("ℹ️ Current behavior: EISDIR (acceptable but custom message preferred).");
        } else if (e.message.includes("FAIL")) {
             throw e;
        } else {
             console.log(`⚠️ Unexpected error for directory: ${e.message}`);
        }
    } finally {
        if (fs.existsSync(DIR_PATH)) fs.rmdirSync(DIR_PATH);
    }

    // 2. Test Large File
    try {
        console.log(`[TEST] Creating large file (~51MB)...`);
        createLargeFile();
        const stats = fs.statSync(LARGE_FILE_PATH);
        console.log(`       File created. Logical Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        console.log("[TEST] Parsing large file...");
        parser.parse(LARGE_FILE_PATH);
        throw new Error("FAIL: Should have thrown error for large file.");
    } catch (e: any) {
        if (e.message.includes("too large")) {
            console.log("✅ PASS: Large file correctly rejected.");
        } else if (e.message.includes("FAIL")) {
            throw e;
        } else {
            console.log(`❌ FAIL: Expected "too large" error, got: ${e.message}`);
            process.exit(1);
        }
    } finally {
        if (fs.existsSync(LARGE_FILE_PATH)) fs.unlinkSync(LARGE_FILE_PATH);
    }
}

// Execute if run directly
if (require.main === module) {
    testLimits().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
