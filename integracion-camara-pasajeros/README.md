# Auditoría VTC: ocupación de cámara

Add-in autocontenido que conserva intactos los archivos originales del repositorio.

El análisis se centra en una sola sospecha: un evento `Passenger.Disallowed` de la cámara durante un tramo de viaje Geotab, sin una coincidencia temporal para la matrícula en el CSV de la APP. La regla **Parada Rápida** delimita segmentos para reducir cruces entre tramos; no suma riesgo ni crea sospechas por sí sola. El mapa de calor incluye exclusivamente esos casos.

La pantalla separa eventos de ocupación recibidos, viajes con ocupación que sí coinciden con el CSV y ocupación sin registro. Si la consulta se realizó correctamente y el período es anterior a la activación de `Passenger.Disallowed`, cero eventos es un resultado esperado.

Compila con `node build.js` desde esta carpeta. `AddIn.json` publica este add-in con clave independiente.