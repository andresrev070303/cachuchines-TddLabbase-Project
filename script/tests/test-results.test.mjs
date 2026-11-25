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
import {
  buildIngestLogsPayload,
  buildTestResultPayload,
  parseRepositoryRemote,
  resolveBackendUrls,
  sendToBackend,
  uploadLatestCommit,
} from '../send-test-results.js';

const execute = promisify(execFile);
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/commit-history.json', import.meta.url), 'utf8'));
const headEntry = fixture.find((entry) => entry.sha === 'HEAD');
const tddLog = [{ numPassedTests: 5, failedTests: 1, numTotalTests: 6, testId: 0 }];
const remoteUrl = 'https://github.com/hu07-demo/repositorio-falso.git';
const metadata = { sha: 'a'.repeat(40), owner: 'hu07-demo', reponame: 'repositorio-falso', branch: 'main' };
const jobsPayload = buildTestResultPayload(headEntry, metadata);

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

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return JSON.parse(body);
}

// Receptor local que imita la URL base del backend: /api/TDDCycles/{jobs|ingest-logs}.
async function receiver(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/TDDCycles`;
  return { server, baseUrl, jobs: `${baseUrl}/jobs`, ingestLogs: `${baseUrl}/ingest-logs` };
}

function readErrors(logFile) {
  return fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('arma el JSON de /jobs con exactamente sha, owner, reponame, conclusion y branch', () => {
  assert.deepEqual(jobsPayload, { ...metadata, conclusion: 'failure' });
  assert.deepEqual(Object.keys(jobsPayload).sort(), ['branch', 'conclusion', 'owner', 'reponame', 'sha']);
  assert.equal(buildTestResultPayload({ conclusion: 'success' }, metadata).conclusion, 'success');
  assert.equal(buildTestResultPayload({ conclusion: 'neutral' }, metadata).conclusion, 'skipped');
  assert.throws(() => buildTestResultPayload({ conclusion: 'cancelled' }, metadata), /Conclusión/);
  assert.throws(() => buildTestResultPayload(headEntry, { ...metadata, sha: 'HEAD' }), /Metadatos/);
});

test('extrae owner y reponame del remoto https y ssh', () => {
  const expected = { owner: 'andresrev070303', reponame: 'cachuchines-TddLabbase-Project' };
  assert.deepEqual(parseRepositoryRemote('https://github.com/andresrev070303/cachuchines-TddLabbase-Project.git'), expected);
  assert.deepEqual(parseRepositoryRemote('https://github.com/andresrev070303/cachuchines-TddLabbase-Project'), expected);
  assert.deepEqual(parseRepositoryRemote('git@github.com:andresrev070303/cachuchines-TddLabbase-Project.git'), expected);
  assert.throws(() => parseRepositoryRemote('no-es-un-remoto'), /owner y reponame/);
  assert.throws(() => parseRepositoryRemote(''), /owner y reponame/);
});

test('arma las URL de los dos endpoints desde TDDLAB_BACKEND_URL', () => {
  const expected = {
    jobs: 'http://localhost:3000/api/TDDCycles/jobs',
    'ingest-logs': 'http://localhost:3000/api/TDDCycles/ingest-logs',
  };
  assert.deepEqual(resolveBackendUrls('http://localhost:3000/api/TDDCycles'), expected);
  assert.deepEqual(resolveBackendUrls('http://localhost:3000/api/TDDCycles/'), expected);
  assert.equal(resolveBackendUrls(''), null);
  assert.equal(resolveBackendUrls(undefined), null);
});

test('arma el JSON de /ingest-logs con los arreglos completos', () => {
  const payload = buildIngestLogsPayload({ ...metadata, commitHistory: fixture, tddLog });
  assert.deepEqual(payload, {
    repoOwner: 'hu07-demo',
    repoName: 'repositorio-falso',
    branch: 'main',
    sha: metadata.sha,
    commitHistory: fixture,
    tddLog,
  });
  assert.throws(() => buildIngestLogsPayload({ ...metadata, branch: '', commitHistory: fixture, tddLog }), /detached HEAD/);
  assert.throws(() => buildIngestLogsPayload({ ...metadata, commitHistory: {}, tddLog }), /arreglos/);
});

test('sin TDDLAB_BACKEND_URL no lee archivos ni requiere un backend', async () => {
  assert.deepEqual(await uploadLatestCommit({ repositoryDirectory: 'no-existe', backendUrl: '' }), { status: 'disabled' });
});

test('/jobs con HTTP 201 queda como registrado', async (t) => {
  let received;
  const { jobs } = await receiver(t, async (req, res) => {
    received = { method: req.method, url: req.url, type: req.headers['content-type'], body: await readJsonBody(req) };
    res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"status":"created"}');
  });
  const result = await sendToBackend('jobs', jobs, jobsPayload);
  assert.deepEqual(result, { status: 'sent', httpStatus: 201 });
  assert.deepEqual(received, { method: 'POST', url: '/api/TDDCycles/jobs', type: 'application/json', body: jobsPayload });
});

test('/jobs con HTTP 200 duplicate no es error y no escribe en el log', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { jobs } = await receiver(t, (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"duplicate"}'));
  const result = await sendToBackend('jobs', jobs, jobsPayload, { errorLogPath: logFile });
  assert.deepEqual(result, { status: 'duplicate', httpStatus: 200 });
  assert.equal(fs.existsSync(logFile), false);
});

test('/jobs con HTTP 409 conflict se registra como error con su motivo', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const reason = '{"status":"conflict"}';
  const { jobs } = await receiver(t, (_req, res) => res.writeHead(409, { 'Content-Type': 'application/json' }).end(reason));
  const result = await sendToBackend('jobs', jobs, jobsPayload, { errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.deepEqual(readErrors(logFile).map(({ endpoint, commitSha, error }) => ({ endpoint, commitSha, error })), [
    { endpoint: 'jobs', commitSha: metadata.sha, error: `HTTP 409: ${reason}` },
  ]);
});

test('HTTP 503 queda registrado con su endpoint y no lanza una excepción', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { ingestLogs } = await receiver(t, (_req, res) => res.writeHead(503).end());
  const payload = buildIngestLogsPayload({ ...metadata, commitHistory: fixture, tddLog });
  const result = await sendToBackend('ingest-logs', ingestLogs, payload, { errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.equal(readErrors(logFile)[0].endpoint, 'ingest-logs');
  assert.equal(readErrors(logFile)[0].error, 'HTTP 503');
  assert.equal(readErrors(logFile)[0].commitSha, metadata.sha);
});

test('HTTP 400 guarda en el log el motivo que devuelve el backend', async (t) => {
  const directory = temporaryDirectory(t);
  const logFile = path.join(directory, 'errors.log');
  const reason = '{"error":"sha es obligatorio","field":"sha"}';
  const { jobs } = await receiver(t, (_req, res) => res.writeHead(400, { 'Content-Type': 'application/json' }).end(reason));
  const result = await sendToBackend('jobs', jobs, jobsPayload, { errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.equal(readErrors(logFile)[0].error, `HTTP 400: ${reason}`);

  const longLog = path.join(directory, 'long.log');
  const { jobs: longJobs } = await receiver(t, (_req, res) => res.writeHead(400).end('x'.repeat(800)));
  await sendToBackend('jobs', longJobs, jobsPayload, { errorLogPath: longLog });
  assert.equal(readErrors(longLog)[0].error, `HTTP 400: ${'x'.repeat(500)}`);
});

test('backend sin conexión queda registrado y permite continuar', async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { server, jobs } = await receiver(t, (_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  const result = await sendToBackend('jobs', jobs, jobsPayload, { errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.ok(readErrors(logFile)[0].error);
});

test('un backend que no responde se cancela por timeout', { timeout: 2000 }, async (t) => {
  const logFile = path.join(temporaryDirectory(t), 'errors.log');
  const { jobs } = await receiver(t, () => {});
  const result = await sendToBackend('jobs', jobs, jobsPayload, { timeoutMs: 80, errorLogPath: logFile });
  assert.equal(result.status, 'failed');
  assert.match(readErrors(logFile)[0].error, /timeout/i);
});

test('si no se puede escribir el log el error tampoco se propaga', async (t) => {
  const { jobs } = await receiver(t, (_req, res) => res.writeHead(500).end());
  const result = await sendToBackend('jobs', jobs, jobsPayload, { errorLogPath: temporaryDirectory(t) });
  assert.equal(result.status, 'failed');
});

async function gitRepository(t, remote = remoteUrl) {
  const directory = temporaryDirectory(t);
  const git = (args, env = process.env) => execute('git', args, { cwd: directory, env, windowsHide: true, timeout: 20000 });
  await git(['init', '--initial-branch=main']);
  await git(['config', 'user.name', 'HU07 Demo']);
  await git(['config', 'user.email', 'hu07@example.invalid']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'core.hooksPath', 'hooks']);
  await git(['remote', 'add', 'origin', remote]);
  fs.mkdirSync(path.join(directory, 'script'));
  return { directory, git };
}

async function repositoryWithFiles(t, { remote, history = JSON.stringify(fixture), log = JSON.stringify(tddLog) } = {}) {
  const { directory, git } = await gitRepository(t, remote);
  fs.writeFileSync(path.join(directory, 'script', 'commit-history.json'), history);
  fs.writeFileSync(path.join(directory, 'script', 'tdd_log.json'), log);
  await git(['commit', '--allow-empty', '-m', 'test: commit base']);
  return { directory, git };
}

test('un tdd_log corrupto solo bloquea /ingest-logs: /jobs se envía igual y el respaldo no se toca', async (t) => {
  const received = [];
  const { baseUrl } = await receiver(t, async (req, res) => {
    received.push(req.url);
    await readJsonBody(req);
    res.writeHead(201).end('{"status":"created"}');
  });
  const { directory } = await repositoryWithFiles(t, { log: 'JSON inválido' });
  const result = await uploadLatestCommit({ repositoryDirectory: directory, backendUrl: baseUrl });
  assert.equal(result.jobs.status, 'sent');
  assert.equal(result['ingest-logs'].status, 'failed');
  assert.deepEqual(received, ['/api/TDDCycles/jobs']);
  assert.equal(fs.readFileSync(path.join(directory, 'script', 'tdd_log.json'), 'utf8'), 'JSON inválido');
  assert.deepEqual(readErrors(path.join(directory, 'script', 'backend-errors.log')).map((record) => record.endpoint), ['ingest-logs']);
});

test('un remoto sin owner/reponame se registra para ambos endpoints sin lanzar', async (t) => {
  const { directory } = await repositoryWithFiles(t, { remote: 'no-es-un-remoto' });
  const result = await uploadLatestCommit({ repositoryDirectory: directory, backendUrl: 'http://127.0.0.1:1' });
  assert.equal(result.jobs.status, 'failed');
  assert.equal(result['ingest-logs'].status, 'failed');
  const errors = readErrors(path.join(directory, 'script', 'backend-errors.log'));
  assert.deepEqual(errors.map((record) => record.endpoint), ['jobs', 'ingest-logs']);
  assert.match(errors[0].error, /owner y reponame/);
});

test('en detached HEAD /ingest-logs no se envía y se registra el motivo', async (t) => {
  const received = [];
  const { baseUrl } = await receiver(t, async (req, res) => {
    received.push({ url: req.url, body: await readJsonBody(req) });
    res.writeHead(201).end('{"status":"created"}');
  });
  const { directory, git } = await repositoryWithFiles(t);
  await git(['checkout', '--detach']);
  const result = await uploadLatestCommit({ repositoryDirectory: directory, backendUrl: baseUrl });
  assert.equal(result.jobs.status, 'sent');
  assert.equal(result['ingest-logs'].status, 'failed');
  assert.deepEqual(received.map((request) => request.url), ['/api/TDDCycles/jobs']);
  assert.equal(received[0].body.branch, '');
  assert.match(readErrors(path.join(directory, 'script', 'backend-errors.log'))[0].error, /detached HEAD/);
});

async function fakeRepository(t) {
  const { directory, git } = await gitRepository(t);
  for (const folder of ['.husky', 'hooks']) {
    fs.mkdirSync(path.join(directory, folder));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(directory, '.gitignore'), 'script/backend-errors.log\n');
  fs.copyFileSync(path.join(projectDirectory, '.husky', 'post-commit'), path.join(directory, '.husky', 'post-commit'));
  fs.copyFileSync(path.join(projectDirectory, 'script', 'send-test-results.js'), path.join(directory, 'script', 'send-test-results.js'));
  // Se usa el hook real. Solo los generadores de resultados se sustituyen por datos falsos.
  fs.writeFileSync(path.join(directory, 'hooks', 'post-commit'), '#!/bin/sh\n[ "$HUSKY" = "0" ] && exit 0\nsh -e .husky/post-commit\n', { mode: 0o755 });
  for (const [script, filename, contents] of [
    ['commitScript.js', 'tdd_log.json', tddLog],
    ['commit-tracker.js', 'commit-history.json', fixture],
  ]) {
    fs.writeFileSync(path.join(directory, 'script', script),
      `import fs from 'node:fs';\nfs.writeFileSync('script/${filename}', ${JSON.stringify(JSON.stringify(contents))});\n`);
  }
  await git(['add', '.']);
  const env = { ...process.env, HUSKY: '1', HUSKY_SKIP_TRACK: '0' };
  return { directory, git, env };
}

test('el hook real envía a /jobs y /ingest-logs con el SHA posterior al amend y conserva ambos JSON', { timeout: 30000 }, async (t) => {
  const received = {};
  const { baseUrl } = await receiver(t, async (req, res) => {
    received[req.url] = await readJsonBody(req);
    res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"status":"created"}');
  });
  const { directory, git, env } = await fakeRepository(t);
  const { stdout, stderr } = await git(['commit', '-m', 'test: HU-07 con repositorio falso'], { ...env, TDDLAB_BACKEND_URL: `${baseUrl}/` });
  const sha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  assert.deepEqual(received['/api/TDDCycles/jobs'], {
    sha, owner: 'hu07-demo', reponame: 'repositorio-falso', conclusion: 'failure', branch: 'main',
  });
  assert.deepEqual(received['/api/TDDCycles/ingest-logs'], {
    repoOwner: 'hu07-demo', repoName: 'repositorio-falso', branch: 'main', sha, commitHistory: fixture, tddLog,
  });
  assert.match(stdout + stderr, /jobs: Resultado registrado \(HTTP 201\)/);
  assert.match(stdout + stderr, /ingest-logs: Logs enviados \(HTTP 201\)/);
  assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/tdd_log.json'])).stdout), tddLog);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'script', 'commit-history.json'), 'utf8')), fixture);
  assert.equal(fs.existsSync(path.join(directory, 'script', 'backend-errors.log')), false);
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  t.diagnostic(`JSON recibido en /jobs: ${JSON.stringify(received['/api/TDDCycles/jobs'])}`);
  t.diagnostic('HTTP 201 en ambos endpoints; SHA recibido = git rev-parse HEAD; ambos respaldos conservados en el commit.');
});

test('el hook real termina el commit y envía /jobs aunque /ingest-logs devuelva HTTP 503', { timeout: 30000 }, async (t) => {
  const received = [];
  const { baseUrl } = await receiver(t, async (req, res) => {
    received.push(req.url);
    await readJsonBody(req);
    if (req.url.endsWith('/ingest-logs')) {
      res.writeHead(503).end();
    } else {
      res.writeHead(201).end('{"status":"created"}');
    }
  });
  const { directory, git, env } = await fakeRepository(t);
  await git(['commit', '-m', 'test: HU-07 con ingest-logs caído'], { ...env, TDDLAB_BACKEND_URL: baseUrl });
  assert.deepEqual(received.sort(), ['/api/TDDCycles/ingest-logs', '/api/TDDCycles/jobs']);
  const errors = readErrors(path.join(directory, 'script', 'backend-errors.log'));
  assert.deepEqual(errors.map(({ endpoint, error }) => ({ endpoint, error })), [{ endpoint: 'ingest-logs', error: 'HTTP 503' }]);
  assert.equal(errors[0].commitSha, (await git(['rev-parse', 'HEAD'])).stdout.trim());
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  t.diagnostic('/jobs HTTP 201 y /ingest-logs HTTP 503; git commit terminó; el log solo registra ingest-logs.');
});

test('el hook real termina el commit con el backend apagado y registra ambos endpoints', { timeout: 30000 }, async (t) => {
  const { server, baseUrl } = await receiver(t, (_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  const { directory, git, env } = await fakeRepository(t);
  await git(['commit', '-m', 'test: HU-07 con backend apagado'], { ...env, TDDLAB_BACKEND_URL: baseUrl });
  const errors = readErrors(path.join(directory, 'script', 'backend-errors.log'));
  assert.deepEqual(errors.map((record) => record.endpoint).sort(), ['ingest-logs', 'jobs']);
  assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/tdd_log.json'])).stdout), tddLog);
  assert.ok((await git(['rev-parse', 'HEAD'])).stdout.trim());
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  t.diagnostic('Backend apagado; git commit terminó correctamente; backend-errors.log registra jobs e ingest-logs.');
});
