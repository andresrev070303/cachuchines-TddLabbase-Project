# Reproducción de HU08 con los scripts de HU07

Usar Node 22 o superior para el proyecto base y Node 24 para TDDLab, las dependencias instaladas de ambos repositorios, PostgreSQL y Cypress. Ejecutar npm ci solo si faltan dependencias. Todas las pruebas de commits usan repositorios temporales; no hacen push ni modifican el historial real.

## Regresión y compilación del proyecto base

Desde TDDLabBaseProject:

```powershell
npm run test:hu07
npx jest --runInBand
npm run build
npx eslint script/send-test-results.js
node --check script/tddScript.js
```

La revisión general npm run lint sigue pendiente; el reporte conserva el resultado inicial. Evitar usar npm test en el repositorio real solo para obtener evidencia: escribe tdd_log.json. La integración ejecuta ese mismo script dentro de repositorios temporales.

## Integración con el backend falso

En TDDLab/server configurar el modo e iniciar la entrada de QA existente:

```powershell
$env:TDD_RESULTS_REPOSITORY='fake'
npm run qa:hu08
```

En TDDLabBaseProject, en otra terminal:

```powershell
$env:TDDLAB_E2E_BACKEND_URL='http://127.0.0.1:3008/api/TDDCycles'
$env:TDDLAB_E2E_STORAGE='fake'
$env:TDDLAB_E2E_EVIDENCE_DIRECTORY='docs/evidencias/hu08/evidence'
node --test script/tests/migration-flow.test.mjs
```

Sin TDDLAB_E2E_BACKEND_URL, esta suite de integración se omite. Eso no acredita una prueba aprobada. No confundir esa variable de QA con TDDLAB_BACKEND_URL, que es la variable del emisor de producción y se configura automáticamente dentro de los repositorios temporales.

## Integración con PostgreSQL

Crear una base exclusiva para pruebas y aplicar server/migrations/008_tdd_migration_validation.sql desde TDDLab. No usar la base compartida. Detener la API falsa antes de reiniciarla en el mismo puerto con estos valores:

```powershell
$env:TDD_RESULTS_REPOSITORY='database'
$env:TDDLAB_DATABASE_URL='postgresql://usuario:clave@localhost:5432/tddlab_hu07'
$env:TDDLAB_DATABASE_SSL='false'
npm run qa:hu08
```

En la terminal de TDDLabBaseProject mantener la URL de QA y el directorio de evidencia y cambiar el modo:

```powershell
$env:TDDLAB_E2E_STORAGE='database'
node --test script/tests/migration-flow.test.mjs
```

La suite usa identificadores nuevos en cada ejecución, deja las filas como evidencia y borra solo su repositorio temporal. Los SHA cambian en cada ejecución. El modo indica el nombre del archivo de evidencia; comprobar que el backend esté realmente configurado con ese almacenamiento.

## Navegador

Mantener la API de base de datos. En TDDLab/Web Ui ejecutar npm run qa:hu08 para servir la página existente en 127.0.0.1:5173. En TDDLabBaseProject, después de compilar, ejecutar en otra terminal node script/tests/serve-build.cjs; sirve dist en 127.0.0.1:1234.

En otra terminal de TDDLabBaseProject configurar la ruta del clon de TDDLab y la misma base usada por el backend:

```powershell
$env:TDDLAB_BACKEND_PROJECT='C:\ruta\TDDLab'
$env:TDDLAB_TEST_DATABASE_URL='postgresql://usuario:clave@localhost:5432/tddlab_hu07'
$env:TDDLAB_E2E_BACKEND_URL='http://127.0.0.1:3008/api/TDDCycles'
npx cypress run --config-file script/tests/migration-browser.config.cjs --browser electron --headless
```

La tarea SELECT usa pg instalado en server del clon indicado y no añade dependencias al proyecto base. Usa conexión local sin SSL para estas pruebas. El navegador lee database-flow.json generado por la integración, compara las dos listas completas y verifica tres tarjetas y Sumador. Antes de repetir todo con otro conjunto de datos, volver a generar ese archivo con la misma base. Las capturas y cypress-results.json corresponden siempre a la última ejecución de Cypress.

## Diferencias documentadas y límites

Los respaldos conservan neutral y HEAD. El envío convierte neutral a skipped y el backend resuelve HEAD en sha y commitId con el SHA final. Se exige igualdad del resto del contenido. El tracker actualiza además los enlaces de commits anteriores al registrar el siguiente commit; la vista se compara contra el historial final, no contra una copia anterior.

Los errores esperados del caso rojo y del backend apagado son datos de prueba. No se implementaron colas, reintentos ni cambios de diseño. No se prueba una sesión completa con autenticación, la instalación inicial de Husky, Neon ni el despliegue compartido. Trello y Notion se publicarán después por decisión del usuario.
