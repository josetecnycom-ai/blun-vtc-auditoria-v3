// Consulta en bloque CameraEvent y conserva diagnóstico de asociación/cobertura por vehículo.
const PassengerCamera = (function() {
    const EVENT_TYPE = 'Passenger.Disallowed';
    let api = null;
    let sessionPromise = null;
    let camerasPromise = null;

    function normalizeSerial(value) { return String(value || '').trim().toUpperCase(); }
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
        if (!camerasPromise) camerasPromise = rawApiCall('Get', { typeName: 'Camera', resultsLimit: 5000 });
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
        fetchForDevices: async function(devices, fromDate, toDate) {
            const eventsByDevice = {};
            const diagnosticsByDevice = {};
            const candidateCameras = [];
            (devices || []).forEach(device => {
                eventsByDevice[device.id] = [];
                diagnosticsByDevice[device.id] = {
                    deviceId: device.id, deviceName: device.name || device.id,
                    deviceSerialNumber: device.serialNumber || '', cameraSerialNumber: '',
                    status: 'pending', reason: '', eventsReceived: 0
                };
                if (!device.serialNumber) {
                    diagnosticsByDevice[device.id].status = 'missing_device_serial';
                    diagnosticsByDevice[device.id].reason = 'El objeto Device no incluye serialNumber.';
                }
            });

            let cameras;
            try { cameras = await getCameras(); }
            catch (error) {
                Object.values(diagnosticsByDevice).forEach(d => {
                    if (d.status === 'pending') { d.status = 'camera_catalog_error'; d.reason = error.message; }
                });
                return { eventsByDevice, diagnosticsByDevice };
            }

            const cameraByDeviceSerial = new Map();
            (cameras || []).forEach(camera => {
                const key = normalizeSerial(camera.deviceSerialNumber);
                if (key && !cameraByDeviceSerial.has(key)) cameraByDeviceSerial.set(key, camera);
            });
            (devices || []).forEach(device => {
                const diagnostic = diagnosticsByDevice[device.id];
                if (diagnostic.status !== 'pending') return;
                const camera = cameraByDeviceSerial.get(normalizeSerial(device.serialNumber));
                if (!camera) {
                    diagnostic.status = 'camera_not_linked';
                    diagnostic.reason = 'No hay Camera.deviceSerialNumber que coincida con Device.serialNumber.';
                    return;
                }
                if (!camera.cameraSerialNumber) {
                    diagnostic.status = 'camera_serial_missing';
                    diagnostic.reason = 'La entidad Camera no incluye cameraSerialNumber.';
                    return;
                }
                diagnostic.cameraSerialNumber = camera.cameraSerialNumber;
                diagnostic.status = 'pending_events';
                candidateCameras.push({ deviceId: device.id, cameraSerialNumber: camera.cameraSerialNumber });
            });

            if (!candidateCameras.length) return { eventsByDevice, diagnosticsByDevice };
            const serials = Array.from(new Set(candidateCameras.map(c => c.cameraSerialNumber)));
            const deviceById = new Set(candidateCameras.map(c => c.deviceId));
            try {
                const search = { fromDate, toDate, cameraSerialNumbers: serials, eventTypeFilter: [{ eventType: EVENT_TYPE }] };
                const allEvents = [];
                const pageSize = 500;
                for (let page = 0; page <= 20; page++) {
                    const batch = await rawApiCall('Get', { typeName: 'CameraEvent', search, resultsLimit: pageSize, page });
                    if (!batch || !batch.length) break;
                    allEvents.push(...batch);
                    if (batch.length < pageSize) break;
                    if (page === 20) throw new Error('Se superó el límite de 10.500 eventos; reduce el período de consulta.');
                }
                allEvents.forEach(event => {
                    if (event.eventType === EVENT_TYPE && deviceById.has(event.deviceId)) eventsByDevice[event.deviceId].push(event);
                });
                candidateCameras.forEach(camera => {
                    const diagnostic = diagnosticsByDevice[camera.deviceId];
                    diagnostic.status = 'ok';
                    diagnostic.eventsReceived = eventsByDevice[camera.deviceId].length;
                });
            } catch (error) {
                candidateCameras.forEach(camera => {
                    const diagnostic = diagnosticsByDevice[camera.deviceId];
                    diagnostic.status = 'camera_event_error';
                    diagnostic.reason = error.message;
                });
            }
            return { eventsByDevice, diagnosticsByDevice };
        },
        analyzeTrips: function(trips, cameraResult, quickStops, toleranceMs) {
            const eventsByDevice = cameraResult.eventsByDevice || {};
            const diagnostics = cameraResult.diagnosticsByDevice || {};
            trips.forEach(trip => {
                const deviceId = trip._device.id;
                const diagnostic = diagnostics[deviceId] || { status: 'camera_not_queried', reason: 'No se consultó esta cámara.', eventsReceived: 0 };
                const available = diagnostic.status === 'ok';
                const segments = segmentsForTrip(trip, quickStops, toleranceMs);
                const events = (eventsByDevice[deviceId] || []).filter(event => {
                    const at = new Date(event.eventStart).getTime();
                    return segments.some(segment => at >= segment.from && at <= segment.to);
                });
                trip._passengerAnalysis = {
                    available, status: diagnostic.status, unavailableReason: diagnostic.reason || null,
                    events, receivedEvents: eventsByDevice[deviceId] || [],
                    hasPassenger: available && events.length > 0, segmentsCount: segments.length
                };
            });
            return trips;
        }
    };
})();