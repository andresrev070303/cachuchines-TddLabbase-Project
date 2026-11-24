# HU-07: primer incremento de envío de resultados

Responsable: Andres. Fecha: 24 de noviembre de 2026.

## Alcance del avance

Este incremento representa un avance inicial estimado del **30% de la HU completa**. La estimación corresponde a la preparación del cliente y su validación local; no certifica integración con el backend del equipo ni almacenamiento en base de datos.

Se implementó un emisor HTTP con configuración por variable de entorno, conexión al hook de commit, tolerancia a errores y pruebas con un receptor falso. El contrato JSON sigue siendo **provisional**, identificado como `hu07-draft-1`.

## Continuación del análisis de scripts y logs

En esta copia del proyecto no existía `docs/`. Se crea esta carpeta para documentar el siguiente paso del flujo ya analizado:

| Componente existente | Responsabilidad |
| --- | --- |
| `script/tddScript.js` | Ejecuta Jest y agrega ejecuciones a `script/tdd_log.json`. |
| `script/commitScript.js` | Agrega un marcador de commit al log. |
| `script/commit-tracker.js` | Reejecuta Jest con cobertura y escribe métricas en `script/commit-history.json`. |
| `.husky/post-commit` | Agrega ambos JSON al commit mediante `git commit --amend --no-edit`. |

Los respaldos actuales son archivos de texto en formato JSON. Se mantienen ambos y no se altera su estructura. Tampoco se modifica el comportamiento de `npm test`.

El nuevo paso se agrega **después del amend**, porque esa operación cambia el SHA del commit. El emisor lee el registro `HEAD` del historial, obtiene el SHA definitivo desde Git y envía ese SHA en el JSON sin reemplazar el marcador del archivo original.

```text
git commit
  -> generadores actuales de logs y métricas
  -> respaldo en tdd_log.json y commit-history.json
  -> amend del commit, como antes
  -> send-test-results.js
       -> POST al endpoint configurado
       -> si falla: advertencia y backend-errors.log; el commit termina
```

Solo se envía el resumen de pruebas que produce el tracker por commit. Las ejecuciones intermedias del ciclo rojo-verde de `tdd_log.json` no se envían en este incremento.

## Contrato provisional

No se encontró un contrato de registro definido en este repositorio. Se propone este formato para probar el cliente; debe validarse con el equipo de backend antes de dar el criterio por completado:

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

`commitSha` es el SHA real posterior al amend; `branch` es `null` si Git está en detached HEAD. `commitTimestamp` proviene de la fecha del commit registrada por el tracker, no de la hora exacta de ejecución de Jest. Los conteos, la cobertura y la conclusión se toman del historial existente. No se calcula un número de pruebas aprobadas restando fallidas porque puede haber pruebas omitidas. La cobertura expresa un porcentaje entre 0 y 100.

## Configuración y uso

Se usa Node.js 20 o posterior, coherente con la versión 20 del CI existente. No se agregaron dependencias al proyecto.

La URL completa se obtiene de **`TDDLAB_RESULTS_ENDPOINT`**. No hay una URL de backend predeterminada en el emisor. Si la variable no existe, el envío se desactiva y los respaldos siguen funcionando.

Ejemplo de configuración en PowerShell, cuando se disponga de un endpoint compatible:

```powershell
# URL ilustrativa; no se ha validado esta ruta en el backend del equipo.
$env:TDDLAB_RESULTS_ENDPOINT = 'http://127.0.0.1:3000/api/test-results'
```

La variable debe estar definida en el proceso desde el que se realizan los commits. No se carga automáticamente un archivo `.env`.

Con los hooks de Husky instalados mediante `npm install`, los commits invocan automáticamente el emisor. También se puede invocar manualmente con `npm run send:test-results` para enviar el resumen del commit actual, si existe su registro `HEAD`. Este comando manual no vuelve a ejecutar Jest ni recupera pendientes.

El envío realiza un `POST` JSON, acepta respuestas 2xx y tiene un límite de espera de **3 segundos**. HTTP 4xx/5xx, errores de red, timeout y errores de lectura se capturan. Se escribe una línea JSON con fecha, SHA cuando está disponible y error en `script/backend-errors.log`, excluido de Git. Si el propio log no puede escribirse, queda una advertencia en consola y el fallo tampoco se propaga.

## Demostración con datos falsos

```powershell
npm run test:hu07
```

Este comando funciona sin backend externo. Levanta receptores HTTP temporales en `127.0.0.1` con puerto libre y utiliza la fixture `script/tests/fixtures/commit-history.json`: 6 pruebas, 1 fallida y cobertura del 80%.

Las pruebas de integración crean repositorios Git temporales con identidad y remoto falsos. Ejecutan el `.husky/post-commit` del proyecto y el emisor real. Solo sustituyen los dos generadores de resultados por scripts que escriben datos falsos; el lanzador de pruebas respeta `HUSKY=0` para evitar recursión durante el amend. Comprueban el SHA final, el POST y la conservación de los respaldos con respuestas HTTP 201 y HTTP 503. No realizan push y eliminan los repositorios temporales al terminar.

Resultado verificado: **10/10 pruebas HU-07 y 1/1 prueba existente de Jest aprobadas**. El emisor también pasó ESLint. La [evidencia de validación](evidencias/hu07-validacion.md) incluye un JSON recibido realmente durante la prueba local.

## Estado de los criterios

| Criterio | Estado en este incremento |
| --- | --- |
| JSON conforme al contrato | Parcial: constructor y validación básica con contrato provisional. Falta el contrato acordado. |
| Envío al endpoint de registro | Parcial: POST automático después del commit validado contra un receptor falso local. |
| URL por configuración | Implementado mediante variable de entorno. |
| Fallo de envío sin interrumpir al estudiante | Implementado y probado para HTTP 503, desconexión y timeout. |
| Conservar archivo actual de respaldo | Conservados los dos JSON existentes; comprobado con el hook. |
| Semana 1 contra backend con repositorio falso; semana 2 contra BD | Pendiente: la simulación local no equivale al backend real ni a la BD. |
| Documentación en `docs/` | Agregada en este documento y su evidencia. |

## Hasta dónde se llegó y qué sigue

El resultado es un cliente inicial demostrable con datos falsos. Quedan pendientes acordar el contrato y endpoint definitivos, adaptar autenticación e identificación de estudiante/entrega si el backend lo exige, probar contra el backend con repositorio falso y comprobar la persistencia en base de datos.

No se implementaron reintentos, cola de pendientes, deduplicación ni migración de historiales. Un envío fallido permanece en los respaldos y se registra como error; no se reenvía automáticamente. Un HTTP 2xx solo indica aceptación del receptor y no demuestra almacenamiento en base de datos.
