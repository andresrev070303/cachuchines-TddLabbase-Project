import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildTestResultPayload, sendTestResults, uploadLatestCommit } from '../send-test-results.js';

const execute = promisify(execFile);
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/commit-history.json', import.meta.url), 'utf8'));
const metadata = {
  repositoryUrl: 'https://github.com/hu07-demo/repositorio-falso.git',
  branch: 'main',
  commitSha: 'a'.repeat(40),
};
const payload = buildTestResultPayload(fixture[0], metadata);

function temporaryDirectory(t) {
  const temporaryRoot = fs.realpathSync(tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'tddlab-hu07-'));
  t.after(() => {
    const resolvedDirectory = fs.realpathSync(directory);
    assert.equal(path.dirname(resolvedDirectory), temporaryRoot);
    assert.match(path.basename(resolvedDirectory), /^tddlab-hu07-/);
    fs.rmSync(resolvedDirectory, { recursive: true, force: true });
  });
  return directory;
}

async function receiver(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { server, endpoint: `http://127.0.0.1:${server.address().port}/api/test-results` };
}

function readError(logFile) {
  return JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
}

test('arma el JSON provisional con datos falsos y un SHA real en lugar de HEAD', () => {
  assert.deepEqual(payload, {
    schemaVersion: 'hu07-draft-1',
    ...metadata,
    commitTimestamp: '2026-11-24T14:00:00.000Z',
    testCount: 6,
    failedTests: 1,
    coverage: 80,
    conclusion: 'failure',
  });
  assert.throws(() => buildTestResultPayload({ ...fixture[0], failed_tests: 7 }, metadata), /Conteos/);
  assert.throws(() => buildTestResultPayload({ ...fixture[0], coverage: 101 }, metadata), /Cobertura/);
  assert.throws(() => buildTestResultPayload(fixture[0], { ...metadata, commitSha: 'HEAD' }), /Metadatos/);
});

test('sin variable de endpoint no lee archivos ni requiere un backend', async () => {
  assert.deepEqual(await uploadLatestCommit({ repositoryDirectory: 'no-existe', endpoint: '' }), { status: 'disabled' });
});

test('envía POST JSON al endpoint configurado y acepta HTTP 201', async (t) => {
  let received;
  const { endpoint } = await receiver(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    received = { method: req.method, url: req.url, type: req.headers['content-type'], body: JSON.parse(Buffer.concat(chunks)) };
    res.writeHead(201).end();
  });
  const result = await sendTestResults(payload, { endpoint });
  assert.deepEqual(result, { status: 'sent', httpStatus: 201 });
  assert.deepEqual(received, { method: 'POST', url: '/api/test-results', type: 'application/json', body: payload });
});

test('HTTP 503 queda registrado y no lanza una excepción', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { endpoint } = await receiver(t, (_req, res) => res.writeHead(503).end());
  const result = await sendTestResults(payload, { endpoint, errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.equal(readError(logFile).error, 'HTTP 503');
  assert.equal(readError(logFile).commitSha, metadata.commitSha);
});

test('HTTP 400 guarda en el log el motivo que devuelve el backend', async (t) => {
  const directory = temporaryDirectory(t);
  const logFile = path.join(directory, 'errors.log');
  const reason = '{"error":"failedTests es obligatorio"}';
  const { endpoint } = await receiver(t, (_req, res) => res.writeHead(400, { 'Content-Type': 'application/json' }).end(reason));
  const result = await sendTestResults(payload, { endpoint, errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.equal(readError(logFile).error, `HTTP 400: ${reason}`);

  const longLog = path.join(directory, 'long.log');
  const { endpoint: longEndpoint } = await receiver(t, (_req, res) => res.writeHead(400).end('x'.repeat(800)));
  await sendTestResults(payload, { endpoint: longEndpoint, errorLogPath: longLog });
  assert.equal(readError(longLog).error, `HTTP 400: ${'x'.repeat(500)}`);
});

test('backend sin conexión queda registrado y permite continuar', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { server, endpoint } = await receiver(t, (_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  const result = await sendTestResults(payload, { endpoint, errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.ok(readError(logFile).error);
});

test('un backend que no responde se cancela por timeout', { timeout: 2000 }, async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { endpoint } = await receiver(t, () => {});
  const result = await sendTestResults(payload, { endpoint, timeoutMs: 80, errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.match(readError(logFile).error, /timeout/i);
});

test('un historial corrupto se registra sin modificar el respaldo', async (t) => {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(path.join(directory, 'script'));
  const historyFile = path.join(directory, 'script', 'commit-history.json');
  fs.writeFileSync(historyFile, 'JSON inválido');
  const result = await uploadLatestCommit({ repositoryDirectory: directory, endpoint: 'http://127.0.0.1:1' });
  assert.equal(result.status, 'failed');
  assert.equal(fs.readFileSync(historyFile, 'utf8'), 'JSON inválido');
  assert.ok(readError(path.join(directory, 'script', 'backend-errors.log')).error);
});

test('si no se puede escribir el log el error tampoco se propaga', async (t) => {
  const { endpoint } = await receiver(t, (_req, res) => res.writeHead(500).end());
  const result = await sendTestResults(payload, { endpoint, errorLogPath: temporaryDirectory(t) });
  assert.equal(result.status, 'failed');
});

async function fakeRepository(t) {
  const directory = temporaryDirectory(t);
  const git = (args, env = process.env) => execute('git', args, { cwd: directory, env, windowsHide: true, timeout: 20000 });
  await git(['init', '--initial-branch=main']);
  await git(['config', 'user.name', 'HU07 Demo']);
  await git(['config', 'user.email', 'hu07@example.invalid']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'core.hooksPath', 'hooks']);
  await git(['remote', 'add', 'origin', metadata.repositoryUrl]);
  for (const folder of ['script', '.husky', 'hooks']) {
    fs.mkdirSync(path.join(directory, folder));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(directory, '.gitignore'), 'script/backend-errors.log\n');
  fs.copyFileSync(path.join(projectDirectory, '.husky', 'post-commit'), path.join(directory, '.husky', 'post-commit'));
  fs.copyFileSync(path.join(projectDirectory, 'script', 'send-test-results.js'), path.join(directory, 'script', 'send-test-results.js'));
  // Se usa el hook real. Solo los generadores de resultados se sustituyen por datos falsos.
  fs.writeFileSync(path.join(directory, 'hooks', 'post-commit'), '#!/bin/sh\n[ "$HUSKY" = "0" ] && exit 0\nsh -e .husky/post-commit\n', { mode: 0o755 });
  const backup = [{ numPassedTests: 5, failedTests: 1, numTotalTests: 6, testId: 0 }];
  for (const [script, filename, contents] of [
    ['commitScript.js', 'tdd_log.json', backup],
    ['commit-tracker.js', 'commit-history.json', fixture],
  ]) {
    fs.writeFileSync(path.join(directory, 'script', script),
      `import fs from 'node:fs';\nfs.writeFileSync('script/${filename}', ${JSON.stringify(JSON.stringify(contents))});\n`);
  }
  await git(['add', '.']);
  const env = { ...process.env, HUSKY: '1', HUSKY_SKIP_TRACK: '0' };
  return { directory, git, env, backup };
}

test('el hook real envía automáticamente el SHA posterior al amend y conserva ambos JSON', { timeout: 30000 }, async (t) => {
  let received;
  const { endpoint } = await receiver(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    received = JSON.parse(body);
    res.writeHead(201).end();
  });
  const { directory, git, env, backup } = await fakeRepository(t);
  const { stdout, stderr } = await git(['commit', '-m', 'test: HU-07 con repositorio falso'], { ...env, TDDLAB_RESULTS_ENDPOINT: endpoint });
  const { stdout: sha } = await git(['rev-parse', 'HEAD']);
  assert.equal(received.commitSha, sha.trim());
  assert.equal(received.repositoryUrl, metadata.repositoryUrl);
  assert.equal(received.branch, 'main');
  assert.equal(received.failedTests, 1);
  assert.match(stdout + stderr, /HTTP 201/);
  assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/tdd_log.json'])).stdout), backup);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'script', 'commit-history.json'), 'utf8')), fixture);
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  t.diagnostic(`JSON recibido por el receptor falso: ${JSON.stringify(received)}`);
  t.diagnostic('HTTP 201; SHA recibido = git rev-parse HEAD; ambos respaldos conservados en el commit.');
});

test('el hook real termina el commit aunque el backend devuelva HTTP 503', { timeout: 30000 }, async (t) => {
  const { endpoint } = await receiver(t, (_req, res) => res.writeHead(503).end());
  const { directory, git, env, backup } = await fakeRepository(t);
  await git(['commit', '-m', 'test: HU-07 con backend caído'], { ...env, TDDLAB_RESULTS_ENDPOINT: endpoint });
  assert.equal(readError(path.join(directory, 'script', 'backend-errors.log')).error, 'HTTP 503');
  assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/tdd_log.json'])).stdout), backup);
  assert.ok((await git(['rev-parse', 'HEAD'])).stdout.trim());
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  t.diagnostic('HTTP 503; git commit terminó correctamente; backend-errors.log registra el error; respaldos conservados.');
});
