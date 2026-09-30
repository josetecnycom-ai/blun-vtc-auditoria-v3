// passenger-camera.js
// Consulta CameraEvent y asigna Passenger.Disallowed a segmentos separados por Parada Rápida.
const PassengerCamera = (function() {
    const EVENT_TYPE = 'Passenger.Disallowed';
    let api = null;
    let sessionPromise = null;
    let camerasPromise = null;
    function getSession() {
        if (!sessionPromise) sessionPromise = new Promise((resolve, reject) => {
            if (!api) return reject(new Error('API no inicializada'));
            api.getSession(session => session ? resolve(session) : reject(new Error('Sesión Geotab no disponible')));
        });
        return sessionPromise;
    }
    async function rawApiCall(method, params) {
        const session = await getSession();
        const response = await fetch('https://' + (session.server || 'my.geotab.com') + '/apiv1', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params: Object.assign({}, params, {
                credentials: { database: session.database, userName: session.userName, sessionId: session.sessionId }
            }) })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status + ' consultando ' + method);
        const payload = await response.json();
        if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
        return payload.result;
    }
    async function getCameras() {
        if (!camerasPromise) camerasPromise = rawApiCall('Get', { typeName: 'Camera' });
        return camerasPromise;
    }
    function segmentsForTrip(trip, quickStops, toleranceMs) {
        const start = new Date(trip.start || trip.startTime).getTime();
        const stop = new Date(trip.stop || trip.stopTime).getTime();
        const stops = quickStops.filter(s => {
            const at = new Date(s.activeFrom).getTime(); return at >= start && at <= stop;
        }).sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));
        const segments = []; let cursor = start;
        stops.forEach(s => {
            const from = new Date(s.activeFrom).getTime(), to = new Date(s.activeTo).getTime();
            if (from > cursor) segments.push({ from: cursor, to: from });
            cursor = Math.max(cursor, to);
        });
        if (cursor < stop) segments.push({ from: cursor, to: stop });
        if (!segments.length && stop >= start) segments.push({ from: start, to: stop });
        return segments.map(s => ({ from: s.from - toleranceMs, to: s.to + toleranceMs }));
    }
    return {
        init: function(geotabApi) { api = geotabApi; },
        fetchForDevice: async function(device, fromDate, toDate) {
            if (!device || !device.serialNumber) return { available: false, reason: 'El vehículo no tiene número de serie GO.', events: [] };
            const cameras = await getCameras();
            const camera = (cameras || []).find(c => c.deviceSerialNumber === device.serialNumber);
            if (!camera || !camera.cameraSerialNumber) return { available: false, reason: 'No se encontró cámara asociada al vehículo.', events: [] };
            const search = { fromDate, toDate, cameraSerialNumbers: [camera.cameraSerialNumber], eventTypeFilter: [{ eventType: EVENT_TYPE }] };
            const events = [];
            for (let page = 0; page <= 20; page++) {
                const batch = await rawApiCall('Get', { typeName: 'CameraEvent', search, resultsLimit: 500, page });
                if (!batch || !batch.length) break;
                batch.forEach(e => { if (e.deviceId === device.id && e.eventType === EVENT_TYPE) events.push(e); });
                if (batch.length < 500) break;
                if (page === 20) throw new Error('Se alcanzó el máximo de páginas de CameraEvent. Reduce el rango de fechas.');
            }
            return { available: true, events };
        },
        analyzeTrips: function(trips, cameraEvents, quickStops, unavailableByDevice, toleranceMs) {
            trips.forEach(trip => {
                const deviceId = trip._device.id, available = !unavailableByDevice[deviceId];
                const segments = segmentsForTrip(trip, quickStops, toleranceMs);
                const events = (cameraEvents[deviceId] || []).filter(event => {
                    const at = new Date(event.eventStart).getTime();
                    return segments.some(segment => at >= segment.from && at <= segment.to);
                });
                trip._passengerAnalysis = { available, unavailableReason: unavailableByDevice[deviceId] || null,
                    events, receivedEvents: cameraEvents[deviceId] || [], hasPassenger: available && events.length > 0, segmentsCount: segments.length };
            });
            return trips;
        }
    };
})();