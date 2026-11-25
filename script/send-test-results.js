/* global AbortSignal, fetch */
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultErrorLog = path.join(projectDirectory, 'script', 'backend-errors.log');

// Contrato provisional: debe acordarse con el equipo de backend antes de producción.
export function buildTestResultPayload(entry, { repositoryUrl, branch, commitSha }) {
  const { test_count: total, failed_tests: failed, coverage, conclusion } = entry;
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(failed) || failed < 0 || failed > total) {
    throw new Error('Conteos de pruebas inválidos');
  }
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
    throw new Error('Cobertura inválida');
  }
  if (!['success', 'failure', 'neutral'].includes(conclusion)) {
    throw new Error('Conclusión de pruebas inválida');
  }
  if (!repositoryUrl || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || !Number.isFinite(Date.parse(entry.commit?.date))) {
    throw new Error('Metadatos del commit inválidos');
  }

  return {
    schemaVersion: 'hu07-draft-1',
    repositoryUrl,
    branch: branch || null,
    commitSha,
    commitTimestamp: entry.commit.date,
    testCount: total,
    failedTests: failed,
    coverage,
    conclusion,
  };
}

function recordFailure(error, errorLogPath, commitSha = null) {
  const record = { timestamp: new Date().toISOString(), commitSha, error: error.message };
  console.warn(`[HU-07] No se enviaron los resultados: ${error.message}. Se conserva el respaldo local.`);
  try {
    fs.appendFileSync(errorLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (logError) {
    console.warn(`[HU-07] No se pudo escribir el log de errores: ${logError.message}`);
  }
  return { status: 'failed', error: error.message };
}

// El backend explica en el cuerpo qué campo falló; se guarda recortado para el log.
async function readErrorDetail(response) {
  try {
    return (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return '';
  }
}

export async function sendTestResults(payload, {
  endpoint = process.env.TDDLAB_RESULTS_ENDPOINT,
  timeoutMs = 3000,
  errorLogPath = defaultErrorLog,
} = {}) {
  if (!endpoint) {
    return { status: 'disabled' };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    await response.body?.cancel();
    console.log(`[HU-07] Resultados enviados (HTTP ${response.status}).`);
    return { status: 'sent', httpStatus: response.status };
  } catch (error) {
    return recordFailure(error, errorLogPath, payload.commitSha);
  }
}

export async function uploadLatestCommit({
  repositoryDirectory = projectDirectory,
  endpoint = process.env.TDDLAB_RESULTS_ENDPOINT,
} = {}) {
  if (!endpoint) {
    console.log('[HU-07] Envío desactivado: configura TDDLAB_RESULTS_ENDPOINT para habilitarlo.');
    return { status: 'disabled' };
  }

  const errorLogPath = path.join(repositoryDirectory, 'script', 'backend-errors.log');
  try {
    const history = JSON.parse(fs.readFileSync(path.join(repositoryDirectory, 'script', 'commit-history.json'), 'utf8'));
    const pendingEntries = history.filter((entry) => entry.sha === 'HEAD');
    if (pendingEntries.length !== 1) {
      throw new Error('Se esperaba un único registro HEAD en commit-history.json');
    }

    const git = (...args) => execFileSync('git', args, {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const payload = buildTestResultPayload(pendingEntries[0], {
      repositoryUrl: git('config', '--get', 'remote.origin.url'),
      branch: git('branch', '--show-current'),
      // El hook invoca este script DESPUÉS del amend que incluye los respaldos.
      commitSha: git('rev-parse', 'HEAD'),
    });
    return await sendTestResults(payload, { endpoint, errorLogPath });
  } catch (error) {
    return recordFailure(error, errorLogPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await uploadLatestCommit();
}
