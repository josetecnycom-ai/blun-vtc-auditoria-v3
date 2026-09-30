# Auditoría VTC: resumen de ocupación de cámara

Add-in autocontenido; el código original del repositorio permanece intacto.

## Modos

- **Sin CSV:** selecciona fechas y uno o todos los vehículos. El resumen muestra viajes Geotab, viajes con eventos `Passenger.Disallowed`, viajes sin evento detectado y viajes sin cobertura de cámara.
- **Con CSV:** carga el archivo opcional. Sus fechas se proponen automáticamente y el add-in cruza ocupación con viajes registrados. La lista y el mapa de calor muestran solo viajes ocupados sin coincidencia temporal en el CSV.

“Sin evento detectado” solo cuenta viajes con consulta de cámara disponible; no confirma por sí solo que viajaran sin pasajeros.

## Diagnóstico y rendimiento

La tabla muestra el serial GO, serial de cámara asociado, eventos recibidos y motivo de cualquier incidencia (por ejemplo, serial no asociado o error en `CameraEvent`). Los viajes y eventos de **Parada Rápida** se solicitan mediante MultiCall en lotes de hasta 100 subconsultas, y los eventos de cámara se consultan en bloque para las cámaras seleccionadas.

Compila desde esta carpeta con `node build.js`. El manifiesto `AddIn.json` publica la copia independiente bajo `integracion-camara-pasajeros/dist/`.