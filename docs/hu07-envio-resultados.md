# HU-07: envío de resultados de tests al backend

Responsable: Carlos. Apoyo: Andrés.

## Qué hace este cambio

Después de cada commit, el script manda al backend de TDDLab dos cosas:

1. El **resultado del commit** (pasó, falló u omitido) al endpoint de registro `/jobs` (HU-03).
2. Los **logs completos** (`commit-history.json` y `tdd_log.json`) a `/ingest-logs`, que es lo que usa la vista para mostrar el ciclo TDD.

Así el avance del estudiante queda guardado en el backend y no solo en archivos dentro de su repositorio.

La URL base del backend se configura con una variable de entorno. Si un envío falla, el commit termina igual y el error queda anotado en un log. Los archivos JSON de siempre se siguen escribiendo como respaldo.

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

El envío se hace **después del amend**, porque el amend cambia el SHA del commit. El script lee el registro `HEAD` de `commit-history.json`, le pide a Git el SHA definitivo, la rama y el remoto, y con eso arma los dos JSON. Los archivos de respaldo no se modifican.

```text
git commit
  -> generadores de logs y métricas (igual que antes)
  -> respaldo en tdd_log.json y commit-history.json
  -> amend del commit (igual que antes)
  -> send-test-results.js
       -> lee SHA definitivo, rama y owner/repo de Git
       -> en paralelo, cada uno con su timeout:
            -> POST {base}/jobs         (resultado del commit, 3 s)
            -> POST {base}/ingest-logs  (historial y log TDD completos, 15 s)
       -> si uno falla: aviso en consola y línea en backend-errors.log
          con el endpoint; el otro se envía igual y el commit termina
```

## Contratos

Los dos endpoints cuelgan de la misma URL base, por ejemplo `http://localhost:3000/api/TDDCycles`.

### 1. Registro del resultado: `POST {base}/jobs` (HU-03)

```json
{
  "sha": "a2e3265055856c95f59bbedf5714d97970fe4185",
  "owner": "andresrev070303",
  "reponame": "cachuchines-TddLabbase-Project",
  "conclusion": "success",
  "branch": "feat/hu-07-backend-results-integration"
}
```

Este es el JSON real que se mandó en la prueba contra el backend con repositorio falso.

- `sha` es el SHA definitivo después del amend (`git rev-parse HEAD`).
- `owner` y `reponame` salen de `remote.origin.url`. Sirven `https://github.com/<owner>/<repo>(.git)` y `git@github.com:<owner>/<repo>.git`. Si no se pueden sacar, el error va al log.
- `conclusion` viene del tracker: `success` → `success`, `failure` → `failure`, `neutral` → `skipped`.
- `branch` es la rama actual (vacía en detached HEAD).

> **Nota:** el backend acepta `branch` en `/jobs`, pero hoy no lo guarda. Eso le corresponde a la HU-03; nosotros lo mandamos igual para que no haya que tocar el script cuando lo guarden.

| Respuesta | Qué hace el script |
| --- | --- |
| `201 {"status":"created"}` | Muestra "Resultado registrado". |
| `200 {"status":"duplicate"}` | Muestra "Ya estaba registrado". **No es error** y no va al log. |
| `409 {"status":"conflict"}` | Mismo SHA con otra conclusión. Es error: va al log con el motivo. |
| `400 {error, field}`, `500`, `503` | Error: va al log con el cuerpo que devuelve el backend. |

Para consultar: `GET {base}/jobs?owner={owner}&repoName={reponame}`. Con el repositorio falso devuelve todos los jobs sin filtrar, así que hay que buscar el SHA en la lista.

### 2. Logs para la vista: `POST {base}/ingest-logs`

```json
{
  "repoOwner": "andresrev070303",
  "repoName": "cachuchines-TddLabbase-Project",
  "branch": "feat/hu-07-backend-results-integration",
  "sha": "a2e3265055856c95f59bbedf5714d97970fe4185",
  "commitHistory": [ "...contenido completo de script/commit-history.json..." ],
  "tddLog": [ "...contenido completo de script/tdd_log.json..." ]
}
```

- `commitHistory` y `tddLog` van **completos**. El backend reemplaza el marcador `HEAD` por el `sha` que mandamos y no duplica lo que ya tiene.
- Si no hay rama (detached HEAD), este envío no se hace y el motivo queda en el log. `/jobs` se envía igual.
- Este endpoint siempre usa la base de datos y no tiene versión falsa. Con el backend en modo falso responde `500 {"error":"Error al guardar los logs TDD"}`, y es lo esperado.
- Para consultar: `GET {base}/get-commits?owner={owner}&repoName={reponame}`.

## Configuración y uso

Se necesita Node.js 20 o superior (el CI usa la versión 20). No agregamos dependencias.

La URL base del backend se lee de **`TDDLAB_BACKEND_URL`**. El script arma `${base}/jobs` y `${base}/ingest-logs`, y si la URL termina en `/` se la quita. No hay ninguna URL escrita en el código. Si la variable no existe, el envío queda desactivado y los respaldos siguen funcionando normal.

### Solo para la terminal actual (PowerShell)

```powershell
$env:TDDLAB_BACKEND_URL = "http://localhost:3000/api/TDDCycles"
```

Esto vale solo mientras esa terminal esté abierta. La variable tiene que existir en el proceso desde el que se hace el commit. Este proyecto no carga ningún archivo `.env`.

### Fija en Windows (para hacer commit desde WebStorm)

WebStorm no ve las variables que se ponen con `$env:` en otra terminal. Para que el hook la encuentre al hacer commit desde el IDE, hay que guardarla en el usuario de Windows:

```powershell
setx TDDLAB_BACKEND_URL "http://localhost:3000/api/TDDCycles"
```

Después hay que **cerrar y volver a abrir WebStorm y la terminal**, porque `setx` no cambia los procesos que ya estaban abiertos. Para desactivar el envío otra vez, se borra la variable desde "Variables de entorno" en la configuración de Windows.

### Levantar el backend para probar

El backend está en el repositorio `UCB-TallerDeDesarrollo/TDDLab`, rama `Cachuchines/FrontedyBackend`, carpeta `server/`. Escucha en el puerto 3000.

```powershell
cd TDDLab
git fetch origin
git checkout Cachuchines/FrontedyBackend
git pull
cd server
npm install
```

Si `git checkout` falla porque ya existe una rama local `cachuchines` (pasa en Windows), se puede usar `git checkout --detach origin/Cachuchines/FrontedyBackend` sin tocar esa rama.

**Modo repositorio falso** (no necesita base de datos; `/jobs` guarda en memoria):

```powershell
$env:TDD_JOBS_REPOSITORY = "fake"; npm run dev
```

**Modo base de datos:** se levanta sin `TDD_JOBS_REPOSITORY`. La cadena de conexión la lee el backend de su propio `server/.env` (variable `TDDLAB_DATABASE_URL`). Ese archivo está en el `.gitignore` del backend y **nunca** se copia a este repositorio ni a la documentación.

```powershell
Remove-Item Env:TDD_JOBS_REPOSITORY -ErrorAction SilentlyContinue; npm run dev
```

### Cómo se envía

Con los hooks de Husky instalados (`npm install`), cada commit llama al emisor automáticamente. También se puede llamar a mano con `npm run send:test-results`, que manda el commit actual si existe su registro `HEAD`. Este comando no vuelve a correr Jest ni reenvía commits anteriores. Si el commit ya estaba registrado, `/jobs` responde `duplicate` y no pasa nada.

Los dos POST salen en paralelo con `Promise.allSettled`. `/jobs` espera como máximo **3 segundos** y `/ingest-logs` **15 segundos**. A `/ingest-logs` le dimos más tiempo porque guarda todo el historial en la BD: en la prueba con Neon tardó entre 4,7 y 8,4 s. Un fallo en uno no impide el otro. Se capturan los errores HTTP 4xx/5xx, los errores de red, el timeout y los errores al leer los JSON o al consultar Git.

Cada error se guarda como una línea JSON en `script/backend-errors.log`, con la fecha, el endpoint (`jobs` o `ingest-logs`), el SHA (si se conoce) y el mensaje. Este archivo está en `.gitignore`. Cuando el backend manda un cuerpo con el error, ese texto se agrega al mensaje recortado a 500 caracteres. Por ejemplo:

```json
{"timestamp":"2026-11-25T22:27:29.890Z","endpoint":"ingest-logs","commitSha":"a2e3265055856c95f59bbedf5714d97970fe4185","error":"HTTP 500: {\"error\":\"Error al guardar los logs TDD\"}"}
```

Si el log no se puede escribir, solo sale un aviso en consola y el commit sigue igual.

## Pruebas

```powershell
npm run test:hu07
```

No hace falta un backend real. Las pruebas levantan receptores HTTP temporales en `127.0.0.1` que imitan la ruta `/api/TDDCycles/{jobs|ingest-logs}`. Usan la fixture `script/tests/fixtures/commit-history.json`, que tiene un commit anterior con conclusión `neutral` y el registro `HEAD` con 6 pruebas, 1 fallida y cobertura del 80%.

Las pruebas de integración crean repositorios Git temporales con un usuario y un remoto falsos, y corren el `.husky/post-commit` real del proyecto junto con el emisor real. Solo cambian los dos generadores de resultados por scripts que escriben datos falsos, y respetan `HUSKY=0` para que el amend no se llame a sí mismo. Revisan tres casos:

- Que lleguen los dos POST con el SHA final y los respaldos se conserven.
- Que si `/ingest-logs` falla, `/jobs` se envía igual y el commit termina.
- Que con el backend apagado el commit termina y el log tiene una línea por endpoint.

No hacen push y borran los repositorios temporales al final.

Resultado actual: **20/20 pruebas de HU-07 y 1/1 prueba de Jest aprobadas**, y el emisor pasa ESLint. También están hechas las pruebas contra el backend real, con repositorio falso y con la base de datos. Los detalles están en la [evidencia de validación](evidencias/hu07-validacion.md).

## Estado de los criterios

| # | Criterio | Estado | Evidencia o de quién depende |
| --- | --- | --- | --- |
| 1 | El JSON se arma con la estructura del contrato | Cumplido | `/jobs` recibe exactamente `{ sha, owner, reponame, conclusion, branch }` y `/ingest-logs` recibe los arreglos completos. Ver [pruebas locales](evidencias/hu07-validacion.md#verificaciones-locales) y el [JSON real enviado](evidencias/hu07-validacion.md#integración-con-el-backend--repositorio-falso). |
| 2 | Después de los tests, el script envía el resultado al endpoint | Cumplido | El hook manda el resultado a `/jobs` después del amend. El backend respondió 201 y el GET devuelve el SHA ([evidencia](evidencias/hu07-validacion.md#integración-con-el-backend--repositorio-falso)). |
| 3 | La URL sale de una variable de configuración | Cumplido | `TDDLAB_BACKEND_URL`. Sin la variable el envío se desactiva ([pruebas locales](evidencias/hu07-validacion.md#verificaciones-locales)). |
| 4 | Si el envío falla no se corta el flujo y queda registrado el error | Cumplido | Commit real con el backend apagado y con `/ingest-logs` fallando; pruebas con 400, 409, 503, sin conexión y timeout. El `duplicate` no cuenta como error ([evidencia](evidencias/hu07-validacion.md#backend-apagado)). |
| 5 | Se sigue escribiendo el archivo de texto como respaldo | Cumplido | `tdd_log.json` y `commit-history.json` se siguen guardando en cada commit ([pruebas locales](evidencias/hu07-validacion.md#verificaciones-locales)). |
| 6 | Semana 1 contra el backend con repositorio falso; semana 2 contra la BD | Cumplido | Semana 1: `/jobs` con 201 y `duplicate` en el reenvío ([evidencia](evidencias/hu07-validacion.md#integración-con-el-backend--repositorio-falso)). Semana 2: `/jobs` e `/ingest-logs` guardados en Neon, commit visible en `/get-commits` con los mismos campos que `commit-history.json` y reenvío sin duplicados ([evidencia](evidencias/hu07-validacion.md#integración-con-la-base-de-datos)). |
| 7 | Cambios documentados en `docs/` | Cumplido | Este documento y `docs/evidencias/hu07-validacion.md`. |

## Observaciones para el backend

Esto no es parte de la HU-07, pero lo vimos en la prueba con la BD (detalle en la [evidencia](evidencias/hu07-validacion.md#lo-que-se-observó-del-backend)):

- `/ingest-logs` tarda más mientras más crece el historial, porque reprocesa todo lo que recibe. Si en algún momento pasa los 15 s, el script lo anota como timeout, pero el commit no se corta.
- La primera consulta a Neon después de un rato sin uso puede pasar los 3 s de `/jobs`. El job igual se guarda, y el reenvío responde `duplicate`.
- Los jobs que crea `/ingest-logs` para commits anteriores quedan con `failure`, aunque el historial dice `success`. Le toca revisarlo a la HU-03.

No implementamos reintentos, cola de pendientes ni migración de historiales. Si un envío falla, el resultado se queda en los respaldos y en el log, pero no se reenvía solo. Igual se puede mandar a mano con `npm run send:test-results` mientras el commit siga siendo `HEAD`.


## Validación complementaria de HU08

La validación del 26 de noviembre de 2026 usa los scripts oficiales contra el backend actualizado, en modo falso y PostgreSQL local. Incluye el caso sin tests, reenvío y backend apagado, y compara la base con la vista. El emisor convierte neutral a skipped al enviar el historial y conserva los JSON originales; tddScript evita reutilizar el reporte de una ejecución anterior cuando no hay tests. Ver el [reporte con capturas](evidencias/hu08/REPORTE_HU08_SCRIPTS.md), su Word y la [reproducción](evidencias/hu08/REPRODUCCION.md). Las evidencias previas de Neon se mantienen como registro histórico de otra revisión del backend.
