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

### HU-07: envío de resultados al backend

Después de cada commit, el hook manda el resultado a `/jobs` y los logs completos a `/ingest-logs` del backend de TDDLab, y conserva los respaldos JSON de siempre. La URL base se configura con `TDDLAB_BACKEND_URL` (por ejemplo `http://localhost:3000/api/TDDCycles`). Sin esa variable el envío queda desactivado. Ya se probó contra el backend con repositorio falso; la prueba con la base de datos está pendiente del esquema en Neon (HU-04).

Pruebas locales sin backend externo: `npm run test:hu07`.

Ver [alcance, configuración y pendientes](docs/hu07-envio-resultados.md) y [evidencia de validación](docs/evidencias/hu07-validacion.md).
