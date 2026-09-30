# Auditoría VTC: resumen de ocupación de cámara

Add-in autocontenido; el código original del repositorio permanece intacto.

## Modo de uso

- **Sin CSV:** selecciona fechas y vehículo(s) y pulsa «Analizar período». El resumen muestra viajes Geotab, viajes con eventos `Passenger.Disallowed`, viajes sin evento detectado y viajes sin cobertura de cámara.
- **Con CSV:** carga el archivo opcional. Sus fechas se proponen automáticamente y el add-in cruza ocupación con viajes registrados. La lista y el mapa de calor muestran solo viajes ocupados sin coincidencia temporal en el CSV.

La regla **Parada Rápida** separa segmentos para asignar eventos de cámara; no suma riesgo por sí misma. “Sin evento detectado” no confirma que no hubiera pasajeros, y solo se cuenta cuando la consulta de cámara estuvo disponible.

Compila desde esta carpeta con `node build.js`. El manifiesto `AddIn.json` registra una clave independiente y publica en `integracion-camara-pasajeros/dist/`.