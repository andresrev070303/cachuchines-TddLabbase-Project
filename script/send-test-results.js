/* global AbortSignal, fetch */
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultErrorLog = path.join(projectDirectory, 'script', 'backend-errors.log');
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

// /ingest-logs guarda todo el historial en la BD y tarda más (4-7 s medidos con 10 commits).
export const defaultTimeouts = { jobs: 3000, 'ingest-logs': 15000 };

// El tracker usa "neutral"; el backend (HU-03) espera "skipped".
const conclusionMap = { success: 'success', failure: 'failure', neutral: 'skipped' };

export function resolveBackendUrls(baseUrl) {
  if (!baseUrl) {
    return null;
  }
  const base = baseUrl.trim().replace(/\/+$/, '');
  return { jobs: `${base}/jobs`, 'ingest-logs': `${base}/ingest-logs` };
}

// Acepta https://github.com/<owner>/<repo>(.git) y git@github.com:<owner>/<repo>.git
export function parseRepositoryRemote(remoteUrl) {
  const match = /^(?:[a-z+]+:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl?.trim() ?? '');
  if (!match) {
    throw new Error(`No se pudo obtener owner y reponame de remote.origin.url: "${remoteUrl ?? ''}"`);
  }
  return { owner: match[1], reponame: match[2] };
}

export function buildTestResultPayload(entry, { sha, owner, reponame, branch }) {
  const conclusion = conclusionMap[entry?.conclusion];
  if (!conclusion) {
    throw new Error('Conclusión de pruebas inválida');
  }
  if (!shaPattern.test(sha ?? '') || !owner || !reponame) {
    throw new Error('Metadatos del commit inválidos');
  }
  return { sha, owner, reponame, conclusion, branch: branch ?? '' };
}

export function buildIngestLogsPayload({ sha, owner, reponame, branch, commitHistory, tddLog }) {
  if (!branch) {
    throw new Error('Sin rama actual (detached HEAD): no se envían los logs');
  }
  if (!shaPattern.test(sha ?? '') || !owner || !reponame) {
    throw new Error('Metadatos del commit inválidos');
  }
  if (!Array.isArray(commitHistory) || !Array.isArray(tddLog)) {
    throw new Error('commit-history.json y tdd_log.json deben ser arreglos');
  }
  // Preserve the local backup; normalize the legacy no-tests value for the API.
  const apiHistory = commitHistory.map((entry) => entry?.conclusion === 'neutral'
    ? { ...entry, conclusion: 'skipped' }
    : entry);
  return { repoOwner: owner, repoName: reponame, branch, sha, commitHistory: apiHistory, tddLog };
}

function recordFailure(endpointName, error, errorLogPath, commitSha = null) {
  const record = { timestamp: new Date().toISOString(), endpoint: endpointName, commitSha, error: error.message };
  console.warn(`[HU-07] ${endpointName}: no se envió: ${error.message}. Se conserva el respaldo local.`);
  try {
    fs.appendFileSync(errorLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (logError) {
    console.warn(`[HU-07] No se pudo escribir el log de errores: ${logError.message}`);
  }
  return { status: 'failed', error: error.message };
}

async function readBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function responseStatus(text) {
  try {
    return JSON.parse(text)?.status;
  } catch {
    return undefined;
  }
}

export async function sendToBackend(endpointName, url, payload, {
  timeoutMs = 3000,
  errorLogPath = defaultErrorLog,
} = {}) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    const text = await readBody(response);
    if (!response.ok) {
      // El backend explica en el cuerpo qué falló (400, 409...); se guarda recortado para el log.
      const detail = text.replace(/\s+/g, ' ').trim().slice(0, 500);
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    if (endpointName === 'jobs' && response.status === 200 && responseStatus(text) === 'duplicate') {
      console.log('[HU-07] jobs: Ya estaba registrado (HTTP 200).');
      return { status: 'duplicate', httpStatus: response.status };
    }
    const message = endpointName === 'jobs' ? 'Resultado registrado' : 'Logs enviados';
    console.log(`[HU-07] ${endpointName}: ${message} (HTTP ${response.status}).`);
    return { status: 'sent', httpStatus: response.status };
  } catch (error) {
    return recordFailure(endpointName, error, errorLogPath, payload.sha);
  }
}

export async function uploadLatestCommit({
  repositoryDirectory = projectDirectory,
  backendUrl = process.env.TDDLAB_BACKEND_URL,
  timeouts = defaultTimeouts,
} = {}) {
  const urls = resolveBackendUrls(backendUrl);
  if (!urls) {
    console.log('[HU-07] Envío desactivado: configura TDDLAB_BACKEND_URL para habilitarlo.');
    return { status: 'disabled' };
  }

  const errorLogPath = path.join(repositoryDirectory, 'script', 'backend-errors.log');
  const readScriptJson = (filename) => JSON.parse(fs.readFileSync(path.join(repositoryDirectory, 'script', filename), 'utf8'));
  let context;
  try {
    const git = (...args) => execFileSync('git', args, {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    context = {
      ...parseRepositoryRemote(git('config', '--get', 'remote.origin.url')),
      branch: git('branch', '--show-current'),
      // El hook invoca este script DESPUÉS del amend que incluye los respaldos.
      sha: git('rev-parse', 'HEAD'),
    };
  } catch (error) {
    return {
      jobs: recordFailure('jobs', error, errorLogPath),
      'ingest-logs': recordFailure('ingest-logs', error, errorLogPath),
    };
  }

  const builders = {
    jobs: () => {
      const pendingEntries = readScriptJson('commit-history.json').filter((entry) => entry.sha === 'HEAD');
      if (pendingEntries.length !== 1) {
        throw new Error('Se esperaba un único registro HEAD en commit-history.json');
      }
      return buildTestResultPayload(pendingEntries[0], context);
    },
    'ingest-logs': () => buildIngestLogsPayload({
      ...context,
      commitHistory: readScriptJson('commit-history.json'),
      tddLog: readScriptJson('tdd_log.json'),
    }),
  };

  // Cada envío es independiente: si uno falla, el otro igual se intenta.
  const names = Object.keys(builders);
  const settled = await Promise.allSettled(names.map(async (name) => {
    let payload;
    try {
      payload = builders[name]();
    } catch (error) {
      return recordFailure(name, error, errorLogPath, context.sha);
    }
    return sendToBackend(name, urls[name], payload, { timeoutMs: timeouts[name], errorLogPath });
  }));
  return Object.fromEntries(names.map((name, index) => [
    name,
    settled[index].status === 'fulfilled'
      ? settled[index].value
      : recordFailure(name, settled[index].reason, errorLogPath, context.sha),
  ]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await uploadLatestCommit();
}
