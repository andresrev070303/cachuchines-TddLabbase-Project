# Evidencia de HU-07

Primera versión: 24 de noviembre de 2026 (receptor local). Actualizada: 25 de noviembre de 2026 (contratos finales y backend con repositorio falso). Entorno: Windows, Node.js v22.15.0 y npm 10.9.2.

## Verificaciones locales

| Comando | Resultado observado |
| --- | --- |
| `npm run test:hu07` | 19 pruebas aprobadas, 0 fallidas. |
| `npx jest` | 1 suite, 1 prueba aprobada: suma de dos números. |
| `npx eslint script/send-test-results.js` | Sin errores ni advertencias. |

Las 19 pruebas de HU-07 cubren:

- JSON de `/jobs` con exactamente `sha`, `owner`, `reponame`, `conclusion` y `branch`, incluido el cambio de `neutral` a `skipped`.
- Extracción de owner y reponame desde remotos https (con y sin `.git`) y ssh.
- URL de los dos endpoints a partir de `TDDLAB_BACKEND_URL`, con o sin `/` al final.
- JSON de `/ingest-logs` con los arreglos completos, y el rechazo en detached HEAD.
- Envío desactivado sin la variable.
- `/jobs` con HTTP 201 (registrado), HTTP 200 `duplicate` (no es error) y HTTP 409 (error con motivo).
- HTTP 503 y HTTP 400 con motivo, sin conexión, timeout y log que no se puede escribir.
- Envíos independientes: un `tdd_log.json` corrupto solo bloquea `/ingest-logs`; un remoto inválido se registra para los dos endpoints.
- El hook real enviando a los dos endpoints; el hook con `/ingest-logs` caído (`/jobs` se envía igual); el hook con el backend apagado.

### JSON recibido por el receptor local

La prueba de integración del hook mostró este JSON para `/jobs`. El remoto y los resultados son falsos. El SHA lo generó Git en el repositorio temporal y coincidía con `git rev-parse HEAD` después del amend.

```json
{"sha":"<SHA del repositorio temporal>","owner":"hu07-demo","reponame":"repositorio-falso","conclusion":"failure","branch":"main"}
```

### Motivo del error que devuelve el backend

Con el receptor respondiendo HTTP 400 y el cuerpo `{"error":"sha es obligatorio","field":"sha"}`, el log guardó:

```text
HTTP 400: {"error":"sha es obligatorio","field":"sha"}
```

Con un cuerpo de 800 caracteres, el log guardó solo los primeros 500.

## Integración con el backend — repositorio falso

Semana 1 del criterio 6. Backend de TDDLab en `origin/Cachuchines/FrontedyBackend` (commit `30685`), levantado en `server/` con `TDD_JOBS_REPOSITORY=fake` en el puerto 3000. El código del backend no se modificó.

Configuración en la terminal del proyecto:

```powershell
$env:TDDLAB_BACKEND_URL = "http://localhost:3000/api/TDDCycles"
```

### Commit real de prueba

Commit `test(hu07): run send check against fake repository backend`. El hook corrió Jest, actualizó los respaldos, hizo el amend y envió los resultados.

SHA definitivo (`git rev-parse HEAD`): `a2e3265055856c95f59bbedf5714d97970fe4185`

JSON enviado a `POST /jobs`:

```json
{
  "sha": "a2e3265055856c95f59bbedf5714d97970fe4185",
  "owner": "andresrev070303",
  "reponame": "cachuchines-TddLabbase-Project",
  "conclusion": "success",
  "branch": "feat/hu-07-backend-results-integration"
}
```

JSON enviado a `POST /ingest-logs`: `repoOwner`, `repoName`, `branch` y `sha` con los mismos valores, más `commitHistory` (6 entradas, la última con el marcador `HEAD`) y `tddLog` (6 entradas). Son los contenidos completos de `script/commit-history.json` y `script/tdd_log.json` de ese commit.

Salida del hook:

```text
[HU-07] jobs: Resultado registrado (HTTP 201).
[HU-07] ingest-logs: no se envió: HTTP 500: {"error":"Error al guardar los logs TDD"}. Se conserva el respaldo local.
```

### Consulta de `/jobs`

`GET http://localhost:3000/api/TDDCycles/jobs?owner=andresrev070303&repoName=cachuchines-TddLabbase-Project` devolvió 4 jobs: los 3 de ejemplo del repositorio falso y este:

```json
{"sha":"a2e3265055856c95f59bbedf5714d97970fe4185","owner":"andresrev070303","reponame":"cachuchines-TddLabbase-Project","conclusion":"success","id":1004}
```

La conclusión coincide con la entrada `HEAD` de `commit-history.json` (`"conclusion": "success"`, 1 prueba, 0 fallidas, cobertura 100).

### Reenvío del mismo commit

`npm run send:test-results`:

```text
[HU-07] jobs: Ya estaba registrado (HTTP 200).
```

El GET siguió devolviendo 4 jobs y una sola coincidencia del SHA. El `duplicate` no se escribió en el log.

### `/ingest-logs` sin base de datos

Este endpoint siempre usa la BD y no tiene versión falsa, así que en este modo falla, y eso es lo esperado. El commit terminó normal y el log guardó:

```json
{"timestamp":"2026-11-25T22:27:29.890Z","endpoint":"ingest-logs","commitSha":"a2e3265055856c95f59bbedf5714d97970fe4185","error":"HTTP 500: {\"error\":\"Error al guardar los logs TDD\"}"}
```

### Backend apagado

Con el backend detenido se hizo el commit `test(hu07): run send check with backend down` (`3c2aa7eaa3a34ed5c65e7ddee1ae6aaf42dac224`). `git commit` terminó con código 0 y el log guardó una línea por endpoint:

```json
{"timestamp":"2026-11-25T22:28:01.154Z","endpoint":"jobs","commitSha":"3c2aa7eaa3a34ed5c65e7ddee1ae6aaf42dac224","error":"fetch failed"}
{"timestamp":"2026-11-25T22:28:01.157Z","endpoint":"ingest-logs","commitSha":"3c2aa7eaa3a34ed5c65e7ddee1ae6aaf42dac224","error":"fetch failed"}
```

## Integración con la base de datos

**Pendiente.** Es la semana 2 del criterio 6.

El 25 de noviembre de 2026 se levantó el backend sin `TDD_JOBS_REPOSITORY`, con la conexión de `server/.env`. El backend se conecta a Neon, pero la base todavía no tiene el esquema: `relation "repository" does not exist` y `relation "commitstable" does not exist`. Por eso `GET /jobs`, `GET /get-commits` y `POST /ingest-logs` responden HTTP 500. El repositorio del backend tampoco tiene un script que cree las tablas que usa (`jobstable`, `commit_timeline`, `project`, `repository`, `"commit"`, `test_execution` y `commitstable`).

No se hizo el commit de prueba contra la BD. Queda pendiente de que el esquema exista en Neon (**HU-04**). Cuando esté, en esta misma rama se repite la prueba y se agrega aquí:

- `/jobs` con 201 y el SHA en el GET con la conclusión correcta.
- `/ingest-logs` con éxito y el commit en `GET /get-commits`.
- La comparación de `test_count`, `failed_tests`, `coverage` y `conclusion` contra `commit-history.json`.
- El reenvío sin duplicados.

## Reproducción y límites

- Pruebas locales: `npm run test:hu07` desde la raíz del proyecto. Los SHA y los puertos cambian en cada ejecución.
- Backend con repositorio falso: ver "Configuración y uso" en [la guía de HU-07](../hu07-envio-resultados.md).

Esta evidencia demuestra el emisor, su integración con el hook y el registro en `/jobs` del backend con repositorio falso. Todavía no demuestra que los datos se guarden en la BD.
