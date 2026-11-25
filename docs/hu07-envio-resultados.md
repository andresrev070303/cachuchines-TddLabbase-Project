# HU-07: envío de resultados de tests al backend

Responsable: Carlos. Apoyo: Andrés.

## Qué hace este cambio

Después de cada commit, el script toma el resumen de tests de ese commit y lo manda por HTTP al endpoint de registro del backend. Así el avance del estudiante queda guardado en el backend y no solo en un archivo dentro de su repositorio.

La URL del endpoint se configura con una variable de entorno. Si el envío falla, el commit termina igual y el error queda anotado en un log. Los archivos JSON de siempre se siguen escribiendo como respaldo.

## Antecedente: análisis de scripts y logs

Este documento sigue el análisis de scripts y logs que ya hicimos en el repositorio del equipo (`docs/02-analisis-scripts-logs.md`). Como en esta copia del proyecto no había carpeta `docs/`, la creamos para documentar el paso nuevo del flujo.

Estos son los scripts que ya existían:

| Componente existente | Qué hace |
| --- | --- |
| `script/tddScript.js` | Corre Jest y agrega cada ejecución a `script/tdd_log.json`. |
| `script/commitScript.js` | Agrega un marcador de commit al log. |
| `script/commit-tracker.js` | Vuelve a correr Jest con cobertura y guarda las métricas en `script/commit-history.json`. |
| `.husky/post-commit` | Mete los dos JSON al commit con `git commit --amend --no-edit`. |

No cambiamos la estructura de esos archivos ni el comportamiento de `npm test`.

El envío se hace **después del amend**, porque el amend cambia el SHA del commit. El script lee el registro `HEAD` de `commit-history.json`, le pide a Git el SHA definitivo y manda ese SHA en el JSON. El archivo de respaldo no se modifica.

```text
git commit
  -> generadores de logs y métricas (igual que antes)
  -> respaldo en tdd_log.json y commit-history.json
  -> amend del commit (igual que antes)
  -> send-test-results.js
       -> POST al endpoint configurado
       -> si falla: aviso en consola y línea en backend-errors.log; el commit termina
```

Solo se manda el resumen por commit que arma el tracker. Las ejecuciones intermedias del ciclo rojo-verde que están en `tdd_log.json` no se envían.

## Contrato (todavía provisional)

El contrato de la HU-01 todavía no está cerrado, así que el JSON sigue siendo provisional y lo marcamos con `schemaVersion: "hu07-draft-1"`. Cuando el contrato esté listo, se ajusta `buildTestResultPayload` y se reemplaza esta sección por el ejemplo final.

```json
{
  "schemaVersion": "hu07-draft-1",
  "repositoryUrl": "https://github.com/hu07-demo/repositorio-falso.git",
  "branch": "main",
  "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "commitTimestamp": "2026-11-24T14:00:00.000Z",
  "testCount": 6,
  "failedTests": 1,
  "coverage": 80,
  "conclusion": "failure"
}
```

- `commitSha` es el SHA real después del amend.
- `branch` es `null` si Git está en detached HEAD.
- `commitTimestamp` sale de la fecha del commit que guarda el tracker, no de la hora en que corrió Jest.
- Los conteos, la cobertura y la conclusión vienen del historial que ya existía. No calculamos las pruebas aprobadas restando las fallidas, porque puede haber pruebas omitidas.
- La cobertura es un porcentaje entre 0 y 100.

## Configuración y uso

Se necesita Node.js 20 o superior (el CI usa la versión 20). No agregamos dependencias.

La URL completa del endpoint se lee de **`TDDLAB_RESULTS_ENDPOINT`**. El script no tiene ninguna URL escrita adentro. Si la variable no existe, el envío queda desactivado y los respaldos siguen funcionando normal.

### Solo para la terminal actual (PowerShell)

```powershell
# URL de ejemplo; reemplazar por el endpoint real del backend
$env:TDDLAB_RESULTS_ENDPOINT = 'http://127.0.0.1:3000/api/test-results'
```

Esto vale solo mientras esa terminal esté abierta. La variable tiene que existir en el proceso desde el que se hace el commit. No se carga ningún archivo `.env`.

### Fija en Windows (para hacer commit desde WebStorm)

WebStorm no ve las variables que se ponen con `$env:` en otra terminal. Para que el hook la encuentre al hacer commit desde el IDE, hay que guardarla en el usuario de Windows:

```powershell
setx TDDLAB_RESULTS_ENDPOINT "<url>"
```

Después hay que **cerrar y volver a abrir WebStorm y la terminal**, porque `setx` no cambia los procesos que ya estaban abiertos. Para desactivar el envío otra vez se puede borrar la variable desde "Variables de entorno" en la configuración de Windows.

### Cómo se envía

Con los hooks de Husky instalados (`npm install`), cada commit llama al emisor automáticamente. También se puede llamar a mano con `npm run send:test-results`, que manda el resumen del commit actual si existe su registro `HEAD`. Este comando no vuelve a correr Jest ni reenvía commits anteriores.

El envío es un `POST` con JSON, acepta cualquier respuesta 2xx y espera como máximo **3 segundos**. Se capturan los errores HTTP 4xx/5xx, los errores de red, el timeout y los errores al leer el historial.

Cada error se guarda como una línea JSON en `script/backend-errors.log`, con la fecha, el SHA (si se conoce) y el mensaje. Este archivo está en `.gitignore`. Cuando el backend responde con un error y manda un cuerpo (por ejemplo, un 400 que dice qué campo falló), ese texto se agrega al mensaje recortado a 500 caracteres, por ejemplo `HTTP 400: {"error":"failedTests es obligatorio"}`. Si el log no se puede escribir, solo sale un aviso en consola y el commit sigue igual.

## Pruebas con datos falsos

```powershell
npm run test:hu07
```

No hace falta un backend real. Las pruebas levantan receptores HTTP temporales en `127.0.0.1` con un puerto libre y usan la fixture `script/tests/fixtures/commit-history.json` (6 pruebas, 1 fallida, cobertura del 80%).

Las pruebas de integración crean repositorios Git temporales con un usuario y un remoto falsos, y corren el `.husky/post-commit` real del proyecto junto con el emisor real. Solo cambian los dos generadores de resultados por scripts que escriben datos falsos, y respetan `HUSKY=0` para que el amend no se llame a sí mismo. Revisan que se mande el SHA final, que llegue el POST y que los respaldos se conserven, tanto con HTTP 201 como con HTTP 503. No hacen push y borran los repositorios temporales al final.

Resultado actual: **11/11 pruebas de HU-07 y 1/1 prueba de Jest aprobadas**, y el emisor pasa ESLint. Los detalles están en la [evidencia de validación](evidencias/hu07-validacion.md).

## Estado de los criterios

| # | Criterio | Estado | Evidencia o de quién depende |
| --- | --- | --- | --- |
| 1 | El JSON se arma con la estructura del contrato | Pendiente | Depende del contrato de la **HU-01**. Hoy se usa el formato provisional `hu07-draft-1`, con validación de conteos, cobertura, conclusión y SHA. |
| 2 | Después de los tests, el script envía el resultado al endpoint | Parcial | El POST automático después del commit está probado con un receptor falso (pruebas 3 y 10). Falta probarlo contra el endpoint real de la **HU-03**. |
| 3 | La URL sale de una variable de configuración | Cumplido | `TDDLAB_RESULTS_ENDPOINT`. Sin la variable el envío se desactiva (prueba 2). |
| 4 | Si el envío falla no se corta el flujo y queda registrado el error | Cumplido | Probado con HTTP 503, HTTP 400 con motivo, sin conexión, timeout y log que no se puede escribir (pruebas 4 a 9 y 11). Falta definir en la **HU-01/HU-03** cómo responde el backend a un commit repetido, para no contarlo como error. |
| 5 | Se sigue escribiendo el archivo de texto como respaldo | Cumplido | `tdd_log.json` y `commit-history.json` se conservan en el commit (pruebas 10 y 11). |
| 6 | Semana 1 contra el backend con repositorio falso; semana 2 contra la BD | Pendiente | La semana 1 depende del endpoint de la **HU-03**. La semana 2 depende de la base de datos de la **HU-04**. Por ahora solo hay pruebas con un receptor local. |
| 7 | Cambios documentados en `docs/` | Cumplido | Este documento y `docs/evidencias/hu07-validacion.md`. |

## Lo que falta

- Ajustar el JSON cuando esté el contrato de la HU-01, incluyendo cómo se identifica al estudiante si el backend lo pide.
- Tratar la respuesta a un commit repetido como "ya registrado" cuando el contrato diga qué código devuelve.
- Probar contra el backend con repositorio falso (semana 1) y contra la base de datos (semana 2), y guardar esa evidencia.

No implementamos reintentos, cola de pendientes ni migración de historiales. Si un envío falla, el resultado se queda en los respaldos y en el log, pero no se reenvía solo. Un HTTP 2xx solo significa que el backend aceptó el JSON; no prueba que se haya guardado en la base de datos.
