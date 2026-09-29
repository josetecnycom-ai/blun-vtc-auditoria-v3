// risk-engine.js
// Evalúa las condiciones del viaje y le asigna un Nivel de Riesgo y Puntuación

const RiskEngine = (function() {

    function getRiskLevel(score) {
        if (score <= 20) return "NORMAL";
        if (score <= 40) return "BAJO";
        if (score <= 60) return "MEDIO";
        if (score <= 80) return "ALTO";
        return "CRÍTICO";
    }

    return {
        /**
         * Calcula el riesgo de un viaje Geotab ya cruzado con APP y analizado por StopAnalyzer.
         * IMPORTANTE: las paradas se evalúan en CONJUNTO, no individualmente.
         * @param {Object} trip - El viaje enriquecido (con `matched` y `_stopAnalysis`)
         * @returns {Object} El objeto audit que se adjuntará al viaje
         */
        evaluateTrip: function(trip) {
            let score = 0;
            let reasons = [];
            let fraudAlert = null;

            const isMatched = trip.matched;
            const gDist = trip.gDist || 0; 
            const stops = trip._stopAnalysis || { quickStops: 0, totalStopTime: 0, stopLocations: [] };

            // ── 1. BASE: No registrado en APP ───────────────────────────────────
            if (!isMatched) {
                score += 50;
                reasons.push("Viaje no registrado en la APP (+50)");
            } else if (trip._matchedCsvTrips && trip._matchedCsvTrips.length > 0) {
                // ── 1.5. VIAJES CANCELADOS POR CONDUCTOR PERO REALIZADOS ──
                let canceladoEfectivo = false;
                let canceladoApp = false;
                trip._matchedCsvTrips.forEach(c => {
                    if (c.status === 'Cancelación del conductor') {
                        if (c.payment && c.payment.toLowerCase() === 'efectivo') {
                            canceladoEfectivo = true;
                        } else {
                            canceladoApp = true;
                        }
                    }
                });

                if (canceladoEfectivo) {
                    score += 100;
                    fraudAlert = "FRAUDE GRAVE: Cancelado en APP (Cobro Efectivo)";
                    reasons.push(`🚨 ${fraudAlert} (+100)`);
                } else if (canceladoApp) {
                    score += 60;
                    fraudAlert = "ALERTA: Cancelado en APP pero realizado físicamente";
                    reasons.push(`🚨 ${fraudAlert} (+60)`);
                }
            }

            // ── 2. CANTIDAD DE PARADAS RÁPIDAS (evaluación conjunta, no acumulada) ──
            const n = stops.quickStops;
            if (n === 1) {
                score += 10;
                reasons.push(`1 parada rápida detectada (+10)`);
            } else if (n === 2) {
                score += 20;
                reasons.push(`2 paradas rápidas detectadas (+20)`);
            } else if (n >= 3 && n <= 5) {
                score += 30;
                reasons.push(`${n} paradas rápidas detectadas (+30)`);
            } else if (n > 5) {
                score += 40;
                reasons.push(`${n} paradas rápidas detectadas (+40)`);
            }

            // ── 3. PARADA MÁS LARGA (solo la peor, no acumulamos todas) ─────────
            // Se evalúa la duración de la parada MÁS LARGA del viaje para evitar inflación
            const maxStopSecs = stops.maxStop || 0;
            if (maxStopSecs > 300) { // Más de 5 min
                score += 30;
                reasons.push(`Parada máxima >5 min (${Math.round(maxStopSecs / 60)}m) (+30)`);
            } else if (maxStopSecs > 180) { // Más de 3 min
                score += 20;
                reasons.push(`Parada máxima >3 min (${Math.round(maxStopSecs / 60)}m) (+20)`);
            } else if (maxStopSecs > 90) { // 90s - 3 min
                score += 10;
                reasons.push(`Parada máxima >90s (${Math.round(maxStopSecs)}s) (+10)`);
            } else if (maxStopSecs >= 45) { // 45-90s
                score += 5;
                reasons.push(`Parada máxima 45-90s (${Math.round(maxStopSecs)}s) (+5)`);
            }

            // ── 4. TIEMPO TOTAL DETENIDO (bloque global, no por parada) ─────────
            const totalStopMin = (stops.totalStopTime || 0) / 60;
            if (totalStopMin > 15) {
                score += 20;
                reasons.push(`Tiempo total detenido >15 min (${Math.round(totalStopMin)}m) (+20)`);
            } else if (totalStopMin > 7) {
                score += 10;
                reasons.push(`Tiempo total detenido >7 min (${Math.round(totalStopMin)}m) (+10)`);
            }

            // ── 5. DISTANCIA TOTAL DEL VIAJE ─────────────────────────────────────
            if (gDist > 20) {
                score += 15;
                reasons.push(`Trayecto largo >20km (${gDist.toFixed(1)}km) (+15)`);
            } else if (gDist > 10) {
                score += 8;
                reasons.push(`Trayecto medio >10km (${gDist.toFixed(1)}km) (+8)`);
            }

            // ── 6. DIFERENCIA DE KILÓMETROS (solo si está cruzado con APP) ───────
            if (isMatched && trip.csvDist !== null && trip.csvDist !== undefined) {
                const safeGDist = gDist > 0 ? gDist : 0.1;
                const diffKm = Math.abs(gDist - trip.csvDist);
                const diffPct = (diffKm / safeGDist) * 100;

                if (diffPct > 20) {
                    score += 20;
                    reasons.push(`Diferencia de distancia >20% (APP: ${trip.csvDist}km vs Geotab: ${gDist.toFixed(1)}km) (+20)`);
                } else if (diffPct > 10) {
                    score += 10;
                    reasons.push(`Diferencia de distancia >10% (APP: ${trip.csvDist}km vs Geotab: ${gDist.toFixed(1)}km) (+10)`);
                }
            }

            const passenger = trip._passengerAnalysis || { hasPassenger: false };
            if (passenger.hasPassenger && !isMatched) {
                score += 100;
                fraudAlert = 'FRAUDE PROBABLE: ocupación detectada y viaje sin registrar en APP';
                reasons.push(`🚨 ${fraudAlert} (${passenger.events.length} evento(s) Passenger.Disallowed) (+100)`);
            } else if (passenger.hasPassenger && isMatched) {
                reasons.push(`Ocupación detectada por cámara; viaje con coincidencia APP (${passenger.events.length} evento(s))`);
            } else if (passenger.available === false) {
                reasons.push(`Cámara sin datos: ${passenger.unavailableReason || 'sin datos'}`);
            }
            const level = getRiskLevel(score);

            return {
                score: score,
                level: level,
                confidence: score, // Puntuación total visible
                reasons: reasons,
                fraudAlert: fraudAlert,
                levelClass: level === 'CRÍTICO' ? 'critico'
                          : level === 'ALTO'    ? 'alto'
                          : level === 'MEDIO'   ? 'medio'
                          : level === 'BAJO'    ? 'bajo'
                          : 'normal'
            };
        }
    };
})();
