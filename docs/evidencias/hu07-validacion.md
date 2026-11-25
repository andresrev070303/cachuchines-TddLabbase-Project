# Evidencia de HU-07

Primera versión: 24 de noviembre de 2026 (receptor local). Actualizada: 25 de noviembre de 2026 (contratos finales, backend con repositorio falso y base de datos). Entorno: Windows, Node.js v22.15.0 y npm 10.9.2.

## Verificaciones locales

| Comando | Resultado observado |
| --- | --- |
| `npm run test:hu07` | 20 pruebas aprobadas, 0 fallidas. |
| `npx jest` | 1 suite, 1 prueba aprobada: suma de dos números. |
| `npx eslint script/send-test-results.js` | Sin errores ni advertencias. |

Las 20 pruebas de HU-07 cubren:

- JSON de `/jobs` con exactamente `sha`, `owner`, `reponame`, `conclusion` y `branch`, incluido el cambio de `neutral` a `skipped`.
- Extracción de owner y reponame desde remotos https (con y sin `.git`) y ssh.
- URL de los dos endpoints a partir de `TDDLAB_BACKEND_URL`, con o sin `/` al final.
- JSON de `/ingest-logs` con los arreglos completos, y el rechazo en detached HEAD.
- Envío desactivado sin la variable.
- `/jobs` con HTTP 201 (registrado), HTTP 200 `duplicate` (no es error) y HTTP 409 (error con motivo).
- HTTP 503 y HTTP 400 con motivo, sin conexión, timeout y log que no se puede escribir.
- Envíos independientes: un `tdd_log.json` corrupto solo bloquea `/ingest-logs`; un remoto inválido se registra para los dos endpoints.
- Un timeout por endpoint: 3 s para `/jobs` y 15 s para `/ingest-logs`.
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

Semana 2 del criterio 6. Mismo backend (`origin/Cachuchines/FrontedyBackend`, commit `30685`), levantado **sin** `TDD_JOBS_REPOSITORY`. La conexión a Neon la lee el backend de su `server/.env`, que no se abrió ni se copió.

### Primer intento: el esquema no existía

En el primer intento, la base de Neon todavía no tenía tablas (`relation "repository" does not exist`, `relation "commitstable" does not exist`), así que `GET /jobs`, `GET /get-commits` y `POST /ingest-logs` respondían HTTP 500. Cuando el equipo creó el esquema (HU-04), los dos GET respondieron HTTP 200 con `[]` y se hizo la prueba.

### Commit 1: `test(hu07): run send check against database backend`

SHA: `03833c7ad16b0a69e65cc97cc918fcb19c209157`. Todavía con 3 s de timeout para los dos endpoints.

```text
[HU-07] jobs: Resultado registrado (HTTP 201).
[HU-07] ingest-logs: no se envió: The operation was aborted due to timeout. Se conserva el respaldo local.
```

`/jobs` registró el commit con `conclusion: "success"`. `/ingest-logs` sí guardó los datos: `GET /get-commits` devolvió los 10 commits del historial, incluido `03833…`. Pero respondió después de los 3 s y el script lo anotó como error. Medido aparte con el mismo payload, `/ingest-logs` tardó entre 4,7 y 6,6 s. Por eso se subió el timeout de `/ingest-logs` a 15 s, y `/jobs` quedó en 3 s (commit `fix(scripts): give ingest-logs a longer timeout`).

### Commit 2: `test(hu07): rerun database send check with longer timeout`

SHA definitivo (`git rev-parse HEAD`): `5a0790945ff138e56150565c488efbcd1931d130`

```text
[HU-07] jobs: no se envió: The operation was aborted due to timeout. Se conserva el respaldo local.
[HU-07] ingest-logs: Logs enviados (HTTP 200).
```

Esta vez `/ingest-logs` respondió dentro del límite. `/jobs` pasó sus 3 s, pero el job **sí quedó guardado** (ver el GET más abajo). Medido aparte, `/jobs` tardó 1,8 s en la primera llamada y 0,4 s en las siguientes, incluso mientras corría `/ingest-logs`. Lo más probable es que la conexión a Neon estuviera fría después de unos minutos sin uso. El commit terminó normal en los dos casos.

### Consulta de `/jobs`

`GET /jobs?owner=andresrev070303&repoName=cachuchines-TddLabbase-Project`:

```json
{"id":12,"sha":"5a0790945ff138e56150565c488efbcd1931d130","owner":"andresrev070303","reponame":"cachuchines-TddLabbase-Project","conclusion":"success","branch":null}
```

`branch` sale `null` porque el backend todavía no lo guarda en `/jobs` (HU-03).

### Consulta de `/get-commits`

`GET /get-commits?owner=andresrev070303&repoName=cachuchines-TddLabbase-Project` devolvió los 12 commits del historial y ninguno con el marcador `HEAD`. El commit de la prueba aparece con su SHA real:

```json
{"sha":"5a0790945ff138e56150565c488efbcd1931d130","test_count":"1","failed_tests":0,"coverage":"100","conclusion":"success","branch":"feat/hu-07-backend-results-integration","message":"test(hu07): rerun database send check with longer timeout"}
```

### Comparación campo por campo

| Campo | `commit-history.json` (entrada `HEAD`) | `/get-commits` (SHA `5a07909…`) | Resultado |
| --- | --- | --- | --- |
| `test_count` | `1` | `"1"` | Igual (el backend lo devuelve como texto) |
| `failed_tests` | `0` | `0` | Igual |
| `coverage` | `100` | `"100"` | Igual (el backend lo devuelve como texto) |
| `conclusion` | `"success"` | `"success"` | Igual |

Los otros 11 commits del historial también coinciden en los cuatro campos.

### Reenvío del mismo commit

`npm run send:test-results`:

```text
[HU-07] jobs: Ya estaba registrado (HTTP 200).
[HU-07] ingest-logs: Logs enviados (HTTP 200).
```

`backend-errors.log` quedó vacío. Después del reenvío seguía habiendo 12 jobs y 12 commits, sin ningún SHA repetido.

### Lo que se observó del backend

Esto no es parte de la HU-07, pero se anota para el equipo:

- **`/ingest-logs` tarda más mientras más crece el historial.** Tardó 4,7 a 6,6 s con 10 commits y 8,4 s con 12, porque reprocesa todo lo que recibe. Con el ritmo medido, va a pasar los 15 s en unas cuantas decenas de commits. El script igual no corta el commit, pero lo anotaría como timeout.
- **Conclusiones de los jobs creados por `/ingest-logs`.** Al procesar el historial, el backend crea jobs para los commits que no tenían uno, y les pone `failure` ("Commits con ultima ejecucion de pruebas rojo"), aunque `commit-history.json` y `/get-commits` dicen `success`. En la BD hay 2 jobs con `success` (los que mandó `/jobs`) y 10 con `failure`. Corresponde revisarlo en la HU-03.

## Reproducción y límites

- Pruebas locales: `npm run test:hu07` desde la raíz del proyecto. Los SHA y los puertos cambian en cada ejecución.
- Backend en modo falso y en modo BD: ver "Configuración y uso" en [la guía de HU-07](../hu07-envio-resultados.md).

Esta evidencia demuestra el emisor, su integración con el hook, el registro en `/jobs` con el repositorio falso y el guardado de `/jobs` y `/ingest-logs` en la base de datos de Neon.
