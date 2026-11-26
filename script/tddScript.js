import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { spawn } from 'cross-spawn';
import process from 'node:process';
import { getLastTestId } from './id_execution_tests_commit.js';

const COMMAND = 'jest';
const args = ['--json', '--outputFile=./script/report.json', '--passWithNoTests'];

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, output });
    });
  });
}

const readJSONFile = (filePath) => {
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData);
};

const writeJSONFile = (filePath, data) => {
  const jsonString = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, jsonString, 'utf-8');
};

const ensureFileExists = (filePath, initialData) => {
  if (!fs.existsSync(filePath)) {
    writeJSONFile(filePath, initialData);
  }
};

const extractAndAddObject = async (reportFile, tddLogFile) => {
  try {
    // Never reuse a report left by a previous test run.
    fs.rmSync(reportFile, { force: true });
    const run = await runCommand(COMMAND, args);

    ensureFileExists(tddLogFile, []);

    // Jest does not emit its JSON report when no test files match.
    const noTests = run.code === 0 && /No tests found/.test(run.output);
    const jsonData = noTests
      ? { numPassedTests: 0, numFailedTests: 0, numTotalTests: 0, startTime: Date.now(), success: true }
      : readJSONFile(reportFile);
    const passedTests = jsonData.numPassedTests;
    const failedTests = jsonData.numFailedTests; 
    const totalTests = jsonData.numTotalTests;
    const startTime = jsonData.startTime;
    const success = jsonData.success;
    let testId = getLastTestId(tddLogFile);

    const newReport = {
      numPassedTests: passedTests,
      failedTests: failedTests,
      numTotalTests: totalTests,
      timestamp: startTime,
      success: success,
      testId: testId
    };

    const tddLog = readJSONFile(tddLogFile);
    tddLog.push(newReport);

    writeJSONFile(tddLogFile, tddLog);
  } catch (error) {
    console.error("Error en la ejecución:", error);
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputFilePath = path.join(__dirname, 'report.json');
const outputFilePath = path.join(__dirname, 'tdd_log.json');

extractAndAddObject(inputFilePath, outputFilePath);

export { extractAndAddObject };