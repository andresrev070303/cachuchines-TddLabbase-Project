# Evidencia local de HU-07

Fecha: 24 de noviembre de 2026. Entorno: Windows, Node.js v22.19.0 y npm 10.9.3.

## Verificaciones realizadas

| Comando | Resultado observado |
| --- | --- |
| `npm run test:hu07` | 11 pruebas aprobadas, 0 fallidas. |
| `npx jest --runInBand --verbose` | 1 suite, 1 prueba aprobada: suma de dos números. |
| `npx eslint script/send-test-results.js` | Sin errores ni advertencias. |

Las 11 pruebas de HU-07 verificaron: construcción del JSON; desactivación sin configuración; POST con HTTP 201; error HTTP 503; error HTTP 400 con motivo en el log; backend sin conexión; timeout; historial corrupto; fallo de escritura del log; hook con envío exitoso; hook con backend caído.

## JSON recibido realmente por el receptor falso

La siguiente carga apareció en la salida de la prueba de integración exitosa. Los resultados de tests y el remoto son falsos; el SHA fue generado realmente por Git en el repositorio temporal y se comprobó que coincidía con `git rev-parse HEAD` después del amend.

```json
{
  "schemaVersion": "hu07-draft-1",
  "repositoryUrl": "https://github.com/hu07-demo/repositorio-falso.git",
  "branch": "main",
  "commitSha": "667fe4055ca89f126b616850a8260b2dad56521d",
  "commitTimestamp": "2026-11-24T14:00:00.000Z",
  "testCount": 6,
  "failedTests": 1,
  "coverage": 80,
  "conclusion": "failure"
}
```

El receptor devolvió HTTP 201. La prueba confirmó la conservación de los dos respaldos en el commit y un árbol de trabajo limpio en el repositorio temporal.

## Fallo controlado del receptor

La segunda prueba de integración configuró el receptor para responder HTTP 503. Se verificó que:

- `git commit` terminó correctamente.
- `script/backend-errors.log` registró `HTTP 503`.
- El respaldo `tdd_log.json` seguía dentro del commit y el historial de métricas se conservaba.

Las pruebas adicionales comprobaron desconexión y timeout de forma aislada, sin lanzar excepciones hacia el flujo llamante.

## Motivo del error que devuelve el backend

Se configuró el receptor para responder HTTP 400 con el cuerpo `{"error":"failedTests es obligatorio"}`. La línea guardada en el log fue:

```text
HTTP 400: {"error":"failedTests es obligatorio"}
```

Con un cuerpo de 800 caracteres, el log guardó solo los primeros 500. En los dos casos el envío devolvió `failed` sin lanzar una excepción.

## Integración con el backend real

Pendiente. La prueba contra el backend con repositorio falso (semana 1, HU-03) y contra la base de datos (semana 2, HU-04) se agregará aquí cuando estén disponibles los endpoints.

## Reproducción y límites

Ejecutar `npm run test:hu07` desde la raíz del proyecto. El SHA y los puertos locales variarán en cada ejecución. Las pruebas se encuentran en `script/tests/test-results.test.mjs`.

Esta evidencia demuestra el cliente y su integración local con el hook usando generadores de datos falsos. No demuestra conexión con el backend del equipo, persistencia en BD ni envío de todos los pasos rojo-verde.
