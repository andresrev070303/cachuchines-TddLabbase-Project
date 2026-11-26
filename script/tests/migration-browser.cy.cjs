// Run against the existing TDDLab HU08 QA page and the base project's built app.
describe('HU08 integración de los scripts oficiales con PostgreSQL y vista', () => {
  it('compara los respaldos reales con SELECT HTTP y los tres bloques', () => {
    cy.readFile('docs/evidencias/hu08/evidence/database-flow.json').then(flow => {
      expect(flow.cases).to.have.length(3);
      const latest = flow.cases[2];
      const history = structuredClone(latest.history).map(entry => ({ ...entry, sha: entry.sha === 'HEAD' ? latest.sha : entry.sha, conclusion: entry.conclusion === 'neutral' ? 'skipped' : entry.conclusion }));
      const logs = structuredClone(latest.logs).map(entry => entry.commitId === 'HEAD' ? { ...entry, commitId: latest.sha } : entry);
      cy.task('officialScriptSnapshot').then(database => {
        expect(database.snapshots).to.have.length(1);
        expect(database.snapshots[0].commit_history).to.deep.equal(history);
        expect(database.snapshots[0].tdd_log).to.deep.equal(logs);
        expect(database.jobs).to.have.length(3);
        expect(new Set(database.jobs.map(row => row.sha)).size).to.equal(3);
      });
      // The shared QA page has a fixed sample owner. Redirect only its identity,
      // branch and port; every response still comes from the real backend and DB.
      for (const endpoint of ['commits-history', 'commit-cycles', 'test-log']) {
        cy.intercept('GET', `**/TDDCycles/${endpoint}*`, req => {
          const url = new URL(req.url);
          const target = new URL(Cypress.env('backendUrl'));
          url.protocol = target.protocol;
          url.host = target.host;
          url.searchParams.set('owner', flow.owner);
          url.searchParams.set('repoName', flow.repo);
          url.searchParams.set('branch', flow.branch);
          req.url = url.toString();
          req.continue();
        }).as(endpoint);
      }
      cy.intercept('GET', '**/commentsSubmission/**', { statusCode: 200, body: [] });
      cy.visit(`/test/manual/hu08-migration.html?repo=${encodeURIComponent(flow.repo)}`);
      cy.wait('@commits-history').then(({ response }) => {
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.have.length(3);
        flow.cases.forEach(scenario => {
          const row = response.body.find(entry => entry.sha === scenario.sha);
          const source = history.find(entry => entry.sha === scenario.sha);
          expect(row.stats).to.deep.equal(source.stats);
          expect(row.coverage).to.equal(source.coverage);
          expect(row.test_count).to.equal(source.test_count);
          expect(row.conclusion).to.equal(scenario.conclusion);
        });
      });
      cy.get('.cycleCardContainer').should('have.length', 3);
      flow.cases.forEach((scenario, index) => {
        const source = history.find(entry => entry.sha === scenario.sha);
        cy.contains('.cycleCardContainer', `Commit: ${source.commit.message}`).within(() => {
          cy.contains('Total de modificaciones:').parent().should('contain', source.stats.total);
          cy.contains('Adiciones:').parent().should('contain', source.stats.additions);
          cy.contains('Sustracciones:').parent().should('contain', source.stats.deletions);
          cy.contains('Cobertura:').parent().should('contain', `${source.coverage}%`);
          cy.contains('Número de Tests:').parent().should('contain', source.test_count || 'Sin tests');
          cy.contains(['Resultado: Exitoso', 'Resultado: Fallido', 'Resultado: Sin tests'][index]).should('be.visible');
          cy.contains('Ver commit').should('have.attr', 'href', source.commit.url);
        });
        cy.contains('.cycleCardWrapper', `Commit: ${source.commit.message}`).screenshot(`0${index+1}-${scenario.name}`);
      });
      cy.screenshot('04-flujo-scripts-base-vista', { capture: 'fullPage' });
    });
  });
  it('la aplicación base compilada sigue sumando en el navegador', () => {
    cy.viewport(900, 500);
    cy.visit('http://127.0.0.1:1234');
    cy.get('#primer-numero').type('4');
    cy.get('#segundo-numero').type('5');
    cy.get('#sumar-button').click();
    cy.get('#resultado-div').should('contain', '9');
    cy.get('body').screenshot('05-sumador-compilado');
  });
});
