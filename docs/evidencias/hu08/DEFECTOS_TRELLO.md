# Defectos preparados para Trello

Publicación diferida por decisión del usuario. Estas fichas todavía no son tarjetas publicadas.

## S01 El log reutiliza resultados al ejecutar sin tests

Prioridad: bloqueante para HU08. Estado local: implementado y verificado.

Pasos: ejecutar una muestra con dos tests y un fallo, eliminar sus archivos de tests y ejecutar tddScript.js otra vez. Antes se reutilizaba report.json y el log repetía dos tests y un fallo.

Resultado esperado: cero tests, cero fallos y un registro nuevo. Implementación: descartar el reporte anterior, permitir la ejecución sin tests y generar el registro vacío solo ante confirmación de Jest. Evidencia: baseline-fake-flow.json, fake-flow.json y database-flow.json; seis tests de integración aprobados en cada modo.

## S02 El historial neutral es rechazado por ingest-logs

Prioridad: bloqueante para el caso sin tests. Estado local: implementado y verificado.

Pasos: enviar un historial con conclusion neutral al backend actual. Antes respondía HTTP 400 con field commitHistory[0].conclusion.

Resultado esperado: aceptar el resultado equivalente skipped sin cambiar el respaldo. Implementación: convertir neutral a skipped solo en el payload de ingesta. Evidencia: baseline-neutral-probe.json, prueba unitaria de entrada intacta y capturas aprobadas del caso sin tests.

## S03 El lint general no está aprobado

Prioridad: no bloqueante del flujo. Estado local: pendiente fuera del alcance acordado.

La revisión general ya fallaba al inicio e incluye archivos generados y reglas de estilo de archivos versionados. No se reformateó el proyecto. El emisor sí pasa ESLint; compilación y pruebas funcionales aprobadas. Evidencia: checks.json y eslint-summary.json.
