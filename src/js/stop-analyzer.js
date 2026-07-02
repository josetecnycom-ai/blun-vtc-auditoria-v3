// stop-analyzer.js
// Analiza las excepciones (Paradas Rápidas) y calcula tiempos reales

const StopAnalyzer = (function() {
    
    // Constante de tiempo a sumar por cada excepción (tiempo que tarda la regla en saltar)
    const OFFSET_SECONDS = 45;

    return {
        /**
         * Cruza los viajes de Geotab con los eventos de excepción
         * @param {Array} trips - Array de viajes Geotab (raw)
         * @param {Array} exceptionEvents - Array de eventos de la regla Parada Rápida
         */
        analyzeTrips: function(trips, exceptionEvents) {
            // Pre-agrupar excepciones por ID de vehículo para acelerar la búsqueda
            const eventsByDevice = {};
            exceptionEvents.forEach(e => {
                const devId = e.device.id;
                if (!eventsByDevice[devId]) eventsByDevice[devId] = [];
                eventsByDevice[devId].push(e);
            });

            // Analizar cada viaje
            trips.forEach(trip => {
                const devId = trip.device ? trip.device.id : trip._device.id;
                const tripEvents = eventsByDevice[devId] || [];
                const tripStart = new Date(trip.start || trip.startTime);
                const tripStop = new Date(trip.stop || trip.stopTime);

                // Filtrar las excepciones que ocurrieron DURANTE este viaje
                const exceptionsInTrip = tripEvents.filter(e => {
                    const eStart = new Date(e.activeFrom);
                    const eStop = new Date(e.activeTo);
                    return eStart >= tripStart && eStop <= tripStop;
                });

                let quickStops = 0;
                let totalStopTime = 0;
                let maxStop = 0;
                let stopLocations = []; 

                exceptionsInTrip.forEach(e => {
                    const durationMs = new Date(e.activeTo) - new Date(e.activeFrom);
                    const durationSecs = durationMs / 1000;
                    
                    // Duración real = duración de la excepción + OFFSET
                    const realDuration = durationSecs + OFFSET_SECONDS;

                    quickStops++;
                    totalStopTime += realDuration;
                    if (realDuration > maxStop) {
                        maxStop = realDuration;
                    }
                    
                    // Guardamos la estructura para el futuro (Fase 7 - Mapa)
                    stopLocations.push({
                        activeFrom: e.activeFrom,
                        activeTo: e.activeTo,
                        durationSecs: realDuration
                    });
                });

                // Inyectamos el análisis en el viaje
                trip._stopAnalysis = {
                    quickStops: quickStops,
                    totalStopTime: totalStopTime,
                    maxStop: maxStop,
                    stopLocations: stopLocations
                };
            });

            return trips;
        }
    };
})();
