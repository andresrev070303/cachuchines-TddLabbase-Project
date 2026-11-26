const { defineConfig } = require('cypress');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '../..');
const evidence = path.join(project, 'docs/evidencias/hu08/evidence');

module.exports = defineConfig({
  env: { backendUrl: process.env.TDDLAB_E2E_BACKEND_URL || 'http://127.0.0.1:3008/api/TDDCycles' },
  video: false,
  viewportWidth: 1280,
  viewportHeight: 1100,
  screenshotsFolder: path.join(evidence, 'screenshots'),
  e2e: {
    baseUrl: 'http://127.0.0.1:5173',
    specPattern: path.join(__dirname, 'migration-browser.cy.cjs'),
    supportFile: false,
    setupNodeEvents(on) {
      on('after:run', result => {
        fs.writeFileSync(path.join(evidence, 'cypress-results.json'), JSON.stringify({
          browser: result.browserName, browserVersion: result.browserVersion,
          totalTests: result.totalTests, totalPassed: result.totalPassed,
          totalFailed: result.totalFailed, startedAt: result.startedTestsAt, endedAt: result.endedTestsAt,
          runs: result.runs?.map(run => ({ spec: run.spec.relative, stats: run.stats, tests: run.tests.map(test => ({ title: test.title, state: test.state, error: test.displayError })) })),
        }, null, 2));
      });
      on('task', {
        async officialScriptSnapshot() {
          if (!process.env.TDDLAB_BACKEND_PROJECT || !process.env.TDDLAB_TEST_DATABASE_URL) throw new Error('Configure TDDLAB_BACKEND_PROJECT y TDDLAB_TEST_DATABASE_URL');
          const backendRequire = createRequire(path.join(process.env.TDDLAB_BACKEND_PROJECT, 'server/package.json'));
          const { Pool } = backendRequire('pg');
          const pool = new Pool({ connectionString: process.env.TDDLAB_TEST_DATABASE_URL, ssl: false, connectionTimeoutMillis: 5000 });
          const flow = JSON.parse(fs.readFileSync(path.join(evidence, 'database-flow.json'), 'utf8'));
          try {
            const snapshot = await pool.query('SELECT commit_history, tdd_log FROM tdd_result_snapshots WHERE owner=$1 AND reponame=$2 AND branch=$3', [flow.owner, flow.repo, flow.branch]);
            const jobs = await pool.query('SELECT sha, owner, reponame, conclusion, branch FROM jobstable WHERE owner=$1 AND reponame=$2 ORDER BY sha', [flow.owner, flow.repo]);
            const result = { snapshots: snapshot.rows, jobs: jobs.rows };
            fs.writeFileSync(path.join(evidence, 'database-select.json'), JSON.stringify(result, null, 2));
            return result;
          } finally { await pool.end(); }
        },
      });
    },
  },
});
