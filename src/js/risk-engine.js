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
         * Calcula el riesgo de un viaje Geotab ya cruzado con APP y analizado por StopAnalyzer
         * @param {Object} trip - El viaje enriquecido (con `matched` y `_stopAnalysis`)
         * @returns {Object} El objeto audit que se adjuntará al viaje
         */
        evaluateTrip: function(trip) {
            let score = 0;
            let reasons = [];

            const isMatched = trip.matched;
            const gDist = (trip.distance || 0) / 1000;
            const stops = trip._stopAnalysis || { quickStops: 0, stopLocations: [] };
            
            // 1. Base: No registrado en APP
            if (!isMatched) {
                score += 50;
                reasons.push("Viaje no registrado en la APP (+50)");
            } else {
                reasons.push("Viaje correctamente registrado");
            }

            // 2. Cantidad de Paradas Rápidas
            if (stops.quickStops === 1) {
                score += 10;
                reasons.push("1 parada rápida detectada (+10)");
            } else if (stops.quickStops === 2) {
                score += 25;
                reasons.push("2 paradas rápidas detectadas (+25)");
            } else if (stops.quickStops >= 3) {
                score += 40;
                reasons.push(`${stops.quickStops} paradas rápidas detectadas (+40)`);
            }

            // 3. Duración de las Paradas (evaluamos cada parada)
            stops.stopLocations.forEach(stop => {
                const s = stop.durationSecs;
                if (s > 300) { // Más de 5 min
                    score += 50;
                    reasons.push(`Parada excesiva >5 min (${Math.round(s/60)}m) (+50)`);
                } else if (s > 180) { // Más de 3 min
                    score += 30;
                    reasons.push(`Parada larga >3 min (${Math.round(s/60)}m) (+30)`);
                } else if (s > 90) { // 90-180 s
                    score += 15;
                    reasons.push(`Parada moderada >90s (${Math.round(s)}s) (+15)`);
                } else if (s >= 45) { // 45-90 s
                    score += 5;
                    reasons.push(`Parada corta 45-90s (${Math.round(s)}s) (+5)`);
                }
            });

            // 4. Distancia total del viaje
            if (gDist > 20) {
                score += 20;
                reasons.push(`Trayecto largo >20km (${gDist.toFixed(1)}km) (+20)`);
            } else if (gDist > 10) {
                score += 10;
                reasons.push(`Trayecto medio >10km (${gDist.toFixed(1)}km) (+10)`);
            }

            // 5. Diferencia de kilómetros (solo si está registrado)
            if (isMatched && trip.csvDist !== null) {
                // Prevenir división por cero si el viaje de Geotab tiene 0 km extrañamente
                const safeGDist = gDist > 0 ? gDist : 0.1;
                const diffKm = Math.abs(gDist - trip.csvDist);
                const diffPct = (diffKm / safeGDist) * 100;

                if (diffPct > 20) {
                    score += 35;
                    reasons.push(`Diferencia distancia >20% (APP: ${trip.csvDist}km vs Geotab: ${gDist.toFixed(1)}km) (+35)`);
                } else if (diffPct > 10) {
                    score += 20;
                    reasons.push(`Diferencia distancia >10% (APP: ${trip.csvDist}km vs Geotab: ${gDist.toFixed(1)}km) (+20)`);
                }
            }

            const level = getRiskLevel(score);
            
            // Limitamos a un máximo lógico para porcentaje
            const confidence = Math.min(score, 100);

            return {
                score: score,
                level: level,
                confidence: confidence, // Para usarlo como "Riesgo: X%"
                reasons: reasons,
                // Clases CSS auxiliares para pintar en la UI
                levelClass: level === 'CRÍTICO' ? 'critico' : level === 'ALTO' ? 'alto' : level === 'MEDIO' ? 'medio' : level === 'BAJO' ? 'bajo' : 'normal'
            };
        }
    };
})();
