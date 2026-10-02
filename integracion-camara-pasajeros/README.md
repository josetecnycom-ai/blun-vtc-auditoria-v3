# Auditoría VTC: resumen de ocupación de cámara

Add-in autocontenido; el código original del repositorio permanece intacto.

## Modos

- **Sin CSV:** selecciona fechas y uno o todos los vehículos. El resumen muestra viajes Geotab, viajes con eventos `Passenger.Disallowed`, viajes sin evento detectado y viajes sin cobertura de cámara.
- **Con CSV:** carga el archivo opcional. Sus fechas se proponen automáticamente y el add-in cruza ocupación con viajes registrados. La lista y el mapa de calor muestran solo viajes ocupados sin coincidencia temporal en el CSV.

“Sin evento detectado” solo cuenta viajes con consulta de cámara disponible; no confirma por sí solo que viajaran sin pasajeros.

## CSV compatibles

- Exportación Uber trip_activity: admite separador coma o punto y coma, con campos entrecomillados; importa filas con estado completed.
- Exportación Historial de viajes: reconoce las columnas Fecha, Tarifa finalizada, Matrícula y Estado; importa Terminado y Cancelación del conductor.
- Las fechas admitidas incluyen dd/MM/yyyy HH:mm[:ss] y yyyy-MM-dd HH:mm[:ss]. Se elimina el BOM UTF-8 si el archivo lo incluye. Si cargas dos copias del mismo viaje, se deduplican por UUID.
## Diagnóstico y rendimiento

La tabla muestra el serial GO, serial de cámara asociado, eventos recibidos y motivo de cualquier incidencia (por ejemplo, serial no asociado o error en `CameraEvent`). Los viajes y eventos de **Parada Rápida** se solicitan mediante MultiCall en lotes de hasta 100 subconsultas, y los eventos de cámara se consultan en bloque para las cámaras seleccionadas.

Compila desde esta carpeta con `node build.js`. El manifiesto `AddIn.json` publica la copia independiente bajo `integracion-camara-pasajeros/dist/`.