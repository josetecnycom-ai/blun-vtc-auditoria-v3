// Clasifica únicamente la discrepancia principal acordada: ocupación de cámara sin viaje CSV.
const RiskEngine = (function() {
    return {
        evaluateTrip: function(trip) {
            const passenger = trip._passengerAnalysis || { hasPassenger: false, events: [] };
            const unregisteredOccupancy = trip.hasCsv && passenger.hasPassenger && !trip.matched;
            const reasons = [];
            if (unregisteredOccupancy) {
                reasons.push(`Passenger.Disallowed: ${passenger.events.length} evento(s) y ningún viaje CSV coincidente.`);
            } else if (passenger.hasPassenger) {
                reasons.push(`Passenger.Disallowed: ${passenger.events.length} evento(s), con viaje CSV coincidente.`);
            } else if (passenger.available === false) {
                reasons.push(`Consulta de cámara no disponible: ${passenger.unavailableReason || 'sin datos'}.`);
            }
            return {
                score: unregisteredOccupancy ? 100 : 0,
                level: unregisteredOccupancy ? 'REVISAR' : 'NORMAL',
                confidence: unregisteredOccupancy ? 100 : 0,
                reasons,
                fraudAlert: unregisteredOccupancy ? 'OCUPACIÓN DETECTADA SIN REGISTRO CSV' : null,
                levelClass: unregisteredOccupancy ? 'alto' : 'normal'
            };
        }
    };
})();