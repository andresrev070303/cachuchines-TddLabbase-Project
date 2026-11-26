// Integration with the TDDLab backend. Uses real generators in disposable Git repositories.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = process.env.TDDLAB_E2E_BACKEND_URL;
const storage = process.env.TDDLAB_E2E_STORAGE || 'configured';
const output = process.env.TDDLAB_E2E_EVIDENCE_DIRECTORY;
const evidence = { storage, backend, startedAt: new Date().toISOString(), cases: [] };
const save = () => {
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${storage}-flow.json`), JSON.stringify(evidence, null, 2));
  }
};
const integration = backend ? test : test.skip;
const sample = failing => `import sumar from './sumador.js';\ntest('suma positiva', () => expect(sumar(3, 2)).toBe(5));\ntest('segunda suma', () => expect(sumar(4, 5)).toBe(${failing ? 10 : 9}));\n`;
const read = (directory, filename) => JSON.parse(fs.readFileSync(path.join(directory, 'script', filename), 'utf8'));
const jsonGet = async url => {
  const response = await fetch(url);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

async function repository(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'tddlab-hu08-official-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
    assert.match(path.basename(directory), /^tddlab-hu08-official-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const folder of ['script', 'src', '.husky', '.qa-hooks']) fs.mkdirSync(path.join(directory, folder));
  for (const filename of ['package.json', '.babelrc', 'src/sumador.js', '.husky/post-commit', 'script/tddScript.js', 'script/commitScript.js', 'script/commit-tracker.js', 'script/id_execution_tests_commit.js', 'script/send-test-results.js']) {
    fs.copyFileSync(path.join(source, filename), path.join(directory, filename));
  }
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(directory, '.gitignore'), 'node_modules/\ncoverage/\nscript/report.json\nscript/backend-errors.log\n');
  // Limit workers for this isolated sample; the project scripts themselves are unchanged.
  fs.writeFileSync(path.join(directory, 'jest.config.cjs'), 'module.exports = { maxWorkers: 1 };\n');
  // Same guard used by Husky to prevent recursive post-commit execution during amend.
  fs.writeFileSync(path.join(directory, '.qa-hooks/post-commit'), '#!/bin/sh\n[ "$HUSKY" = "0" ] && exit 0\nsh -e .husky/post-commit\n', { mode: 0o755 });
  fs.writeFileSync(path.join(directory, 'script/commit-history.json'), '[]\n');
  fs.writeFileSync(path.join(directory, 'script/tdd_log.json'), '[]\n');
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${path.join(source,'node_modules/.bin')}${path.delimiter}${process.env.PATH}`, HUSKY_SKIP_TRACK: '0', TDDLAB_BACKEND_URL: backend };
  delete env.ELECTRON_RUN_AS_NODE;
  const command = async (binary, args, overrides={}) => {
    try {
      const result = await execute(binary, args, { cwd: directory, env: { ...env, ...overrides }, windowsHide: true, timeout: 90000, maxBuffer: 8*1024*1024 });
      return { ...result, exitCode: 0 };
    } catch (error) {
      error.message += `\n${error.stdout || ''}\n${error.stderr || ''}`;
      throw error;
    }
  };
  const git = (args, overrides={}) => command('git', args, overrides);
  await git(['init', '--initial-branch=feature/hu07-validation']);
  await git(['config', 'user.name', 'HU08 Validation']);
  await git(['config', 'user.email', 'hu08@example.invalid']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'core.hooksPath', '.qa-hooks']);
  const owner = 'hu07-validation';
  const repo = `official-scripts-${storage}-${Date.now()}`;
  await git(['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`]);
  await git(['add', '.']);
  await git(['commit', '-m', 'Prueba de preparación del entorno'], { HUSKY: '0' });
  return { directory, command, git, owner, repo, branch: 'feature/hu07-validation' };
}

integration('HU08 scripts oficiales ejecutar respaldar registrar consultar y repetir', { timeout: 180000 }, async t => {
  const fixture = await repository(t);
  const { directory, command, git, owner, repo, branch } = fixture;
  Object.assign(evidence, { owner, repo, branch });
  const query = new URLSearchParams({ owner, repoName: repo, branch });
  try {
    for (const scenario of [
      { name: 'aprobados', total: 2, failed: 0, conclusion: 'success' },
      { name: 'fallidos', total: 2, failed: 1, conclusion: 'failure' },
      { name: 'sin-tests', total: 0, failed: 0, conclusion: 'skipped' },
    ]) {
      await t.test(scenario.name, async () => {
        const filename = path.join(directory, 'src/sumador.test.js');
        if (scenario.total) fs.writeFileSync(filename, sample(scenario.failed > 0));
        else fs.unlinkSync(filename);
        const run = await command(process.execPath, ['script/tddScript.js']);
        const afterTests = read(directory, 'tdd_log.json');
        const execution = afterTests.filter(row => row.numTotalTests !== undefined).at(-1);
        evidence.lastExecution = { scenario: scenario.name, execution, output: run.stdout + run.stderr };
        save();
        assert.equal(execution?.numTotalTests, scenario.total, 'tdd_log debe representar esta ejecución, sin reutilizar resultados anteriores');
        assert.equal(execution.failedTests, scenario.failed);
        await git(['add', '.']);
        const commit = await git(['commit', '-m', `Prueba HU08 ${scenario.name}`], { HUSKY: '1' });
        const sha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
        const history = read(directory, 'commit-history.json');
        const logs = read(directory, 'tdd_log.json');
        const head = history.find(row => row.sha === 'HEAD');
        assert.equal(head.test_count, scenario.total);
        assert.equal(head.failed_tests, scenario.failed);
        assert.equal(head.conclusion, scenario.total ? scenario.conclusion : 'neutral');
        const consoleOutput = commit.stdout + commit.stderr;
        evidence.lastCommitOutput = consoleOutput;
        save();
        assert.match(consoleOutput, /jobs: Resultado registrado \(HTTP 201\)/);
        assert.match(consoleOutput, /ingest-logs: Logs enviados \(HTTP 200\)/);
        const jobs = await jsonGet(`${backend}/jobs?${query}`);
        const visible = await jsonGet(`${backend}/commits-history?${query}`);
        const remoteLogs = await jsonGet(`${backend}/test-log?${query}`);
        const job = jobs.find(row => row.sha === sha);
        assert.deepEqual({ ...job, id: undefined }, { sha, owner, reponame: repo, conclusion: scenario.conclusion, branch, id: undefined });
        const projected = visible.find(row => row.sha === sha);
        assert.equal(projected.test_count, head.test_count);
        assert.equal(projected.coverage, head.coverage);
        assert.equal(projected.conclusion, scenario.conclusion);
        assert.deepEqual(projected.stats, head.stats);
        assert.deepEqual(projected.commit, head.commit);
        assert.equal(remoteLogs.at(-1).commitId, sha);
        assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/commit-history.json'])).stdout), history);
        assert.deepEqual(JSON.parse((await git(['show', 'HEAD:script/tdd_log.json'])).stdout), logs);
        assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
        evidence.cases.push({ ...scenario, sha, history, logs, job, projected, execution, consoleOutput });
        save();
      });
    }
    await t.test('reenvío del SHA final sin duplicados ni cambios de respaldo', async () => {
      const before = ['commit-history.json','tdd_log.json'].map(name => fs.readFileSync(path.join(directory,'script',name),'utf8'));
      const result = await command(process.execPath, ['script/send-test-results.js']);
      assert.match(result.stdout, /Ya estaba registrado \(HTTP 200\)/);
      assert.match(result.stdout, /Logs enviados \(HTTP 200\)/);
      const jobs = await jsonGet(`${backend}/jobs?${query}`);
      const visible = await jsonGet(`${backend}/commits-history?${query}`);
      assert.equal(jobs.length, 3);
      assert.equal(visible.length, 3);
      assert.equal(new Set(jobs.map(row=>row.sha)).size, 3);
      assert.deepEqual(['commit-history.json','tdd_log.json'].map(name=>fs.readFileSync(path.join(directory,'script',name),'utf8')), before);
      assert.equal(fs.existsSync(path.join(directory,'script/backend-errors.log')), false);
      evidence.repeated = { jobs, visible, consoleOutput:result.stdout+result.stderr, originalFilesUnchanged:true };
      save();
    });
    await t.test('backend apagado permite terminar el commit y conserva respaldo y errores', async () => {
      fs.writeFileSync(path.join(directory,'src/sumador.test.js'),sample(false));
      await command(process.execPath,['script/tddScript.js']);
      await git(['add','.']);
      const result = await git(['commit','-m','Prueba HU08 backend apagado'],{HUSKY:'1',TDDLAB_BACKEND_URL:'http://127.0.0.1:1/api/TDDCycles'});
      const sha=(await git(['rev-parse','HEAD'])).stdout.trim();
      const errors=fs.readFileSync(path.join(directory,'script/backend-errors.log'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
      assert.deepEqual(errors.map(row=>row.endpoint).sort(),['ingest-logs','jobs']);
      assert.ok(errors.every(row=>row.commitSha===sha&&row.error));
      assert.deepEqual(JSON.parse((await git(['show','HEAD:script/tdd_log.json'])).stdout),read(directory,'tdd_log.json'));
      assert.equal((await git(['status','--porcelain'])).stdout.trim(),'');
      evidence.offline={sha,exitCode:result.exitCode,errors,consoleOutput:result.stdout+result.stderr,backupsCommitted:true};
      save();
    });
  } finally { evidence.endedAt=new Date().toISOString();save(); }
});
