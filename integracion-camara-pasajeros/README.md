# Integración VTC + cámara de pasajeros

Add-in autocontenido basado en el comparador VTC. Esta carpeta se publica como un add-in independiente y conserva intactos los archivos originales del repositorio.

- Lee CSV Uber/Bolt y viajes Geotab como el comparador base.
- Consulta `CameraEvent` de tipo `Passenger.Disallowed` en la cámara asociada al número de serie del dispositivo.
- Divide cada viaje en segmentos según la regla **Parada Rápida** y aplica 3 minutos de tolerancia en los bordes.
- Marca **FRAUDE PROBABLE** cuando se detecta ocupación en un viaje Geotab sin coincidencia APP. La señal orienta una revisión; por sí sola no prueba pago ni prestación comercial.
- Diferencia cámara sin asociar/error de consulta de una cámara consultada sin eventos.

Compila desde esta carpeta con `node build.js`. El `AddIn.json` usa una clave nueva y la ruta GitHub Pages `integracion-camara-pasajeros/dist/`.