#### Proyeto base para proyectos tddlab:

#### Creado a partir de proyecto usado en IngSoftware: parcel-jest-base

https://github.com/israelantezana/parcel-jest-base

#### Comandos creados en package json:

#### Para instalar las dependencias:

npm install

#### Comandos de uso:

Ejecutar web-sever local parcel:
npm start

Ejecutar pruebas de unidad de forma continua --watch:
npm test

Ejecutar pruebas de unidad solo una vez:
npm run test-once

### HU-07: avance de envío de resultados al backend

Se agregó un emisor que utiliza `TDDLAB_RESULTS_ENDPOINT` y se ejecuta después del commit, conservando los respaldos JSON actuales. El contrato es provisional y el avance se validó con datos falsos.

Demostración local sin backend externo: `npm run test:hu07`.

Ver [alcance, configuración y pendientes](docs/hu07-envio-resultados.md) y [evidencia de validación](docs/evidencias/hu07-validacion.md).
