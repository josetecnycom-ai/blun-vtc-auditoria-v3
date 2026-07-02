// data-manager.js
// Maneja toda la comunicación con Geotab, el parseo del CSV y el estado de los datos

const DataManager = (function() {
    let api = null;
    
    // Caché de entidades
    let cache = {
        users: null,
        devices: null,
        rules: null
    };

    // Estado del CSV
    let csvData = {
        trips: [],
        plates: new Set(),
        minDate: null,
        maxDate: null
    };

    // ── NORMALIZAR MATRÍCULA ─────────────────────────────────
    function normPlate(p) {
        return String(p || '').replace(/[\s\-]/g, '').toUpperCase().trim();
    }

    // ── PARSEAR FECHA DD/MM/YYYY HH:MM ───────────────────────
    function parseDate(s) {
        if (!s) return null;
        const m = s.match(/(\d{1,2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
    }

    // ── WRAPPER API ──────────────────────────────────────────
    function callApi(method, params) {
        return new Promise((resolve, reject) => {
            if (!api) return reject(new Error("API no inicializada"));
            api.call(method, params, resolve, reject);
        });
    }

    return {
        init: function(geotabApi) {
            api = geotabApi;
        },

        // ── CACHÉ INTELIGENTE ────────────────────────────────────
        getUsers: async function() {
            if (cache.users) return cache.users;
            const users = await callApi('Get', { typeName: 'User', resultsLimit: 5000 });
            cache.users = {};
            users.forEach(u => {
                cache.users[u.id] = (u.firstName && u.lastName) ? (u.firstName + ' ' + u.lastName) : (u.name || 'Desconocido');
            });
            return cache.users;
        },

        getDevices: async function() {
            if (cache.devices) return cache.devices;
            const devices = await callApi('Get', { typeName: 'Device', resultsLimit: 2000 });
            cache.devices = {
                byId: {},
                byPlate: {} // Mapeo de matrícula normalizada a device
            };
            devices.forEach(d => {
                cache.devices.byId[d.id] = d;
                const np = normPlate(d.name);
                if (np) cache.devices.byPlate[np] = d;
            });
            return cache.devices;
        },

        getRules: async function() {
            if (cache.rules) return cache.rules;
            const rules = await callApi('Get', { typeName: 'Rule', resultsLimit: 5000 });
            cache.rules = rules;
            return cache.rules;
        },

        // ── LLAMADAS DIRECTAS (Sin Caché Global) ─────────────────
        getTrips: async function(deviceId, fromDate, toDate) {
            return await callApi('Get', {
                typeName: 'Trip',
                search: {
                    fromDate: fromDate,
                    toDate: toDate,
                    deviceSearch: { id: deviceId }
                },
                resultsLimit: 50000
            });
        },

        getExceptionEvents: async function(ruleId, fromDate, toDate) {
            return await callApi('Get', {
                typeName: 'ExceptionEvent',
                search: {
                    ruleSearch: { id: ruleId },
                    fromDate: fromDate,
                    toDate: toDate
                },
                resultsLimit: 100000
            });
        },

        // ── GESTIÓN DE CSV ───────────────────────────────────────
        parseCSV: function(text, filename) {
            text = text.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) throw new Error("CSV vacío o sin datos válidos");

            const header = lines[0].split(';');
            const idx = {};
            header.forEach((h, i) => { idx[h.trim()] = i; });

            const trips = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(';');
                const estado = (cols[idx['Estado del viaje']] || '').trim();
                if (estado !== 'completed') continue;

                const plate = normPlate(cols[idx['Matrícula']]);
                const reqStr = (cols[idx['Hora de la solicitud del viaje']] || '').trim();
                const arrStr = (cols[idx['Hora de llegada del viaje']] || '').trim();
                if (!plate || !reqStr || !arrStr) continue;

                trips.push({
                    uuid: cols[idx['UUID del viaje']],
                    conductor: (cols[idx['Nombre del conductor']] || '') + ' ' + (cols[idx['Apellido del conductor']] || ''),
                    plate: plate,
                    plateRaw: cols[idx['Matrícula']],
                    reqTime: parseDate(reqStr),
                    arrTime: parseDate(arrStr),
                    origin:  cols[idx['Dirección de recogida']] || '',
                    dest:    cols[idx['Dirección de destino']] || '',
                    dist:    parseFloat((cols[idx['Distancia del viaje']] || '0').replace(',','.')),
                    product: cols[idx['Tipo de producto']] || '',
                    payment: cols[idx['Tipo de pago']] || '',
                });
            }

            if (trips.length === 0) throw new Error("No se encontraron viajes 'completed' válidos en el CSV.");

            const allDates = trips.map(t => t.reqTime).filter(Boolean);
            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));
            minDate.setHours(0,0,0,0);
            maxDate.setHours(23,59,59,999);

            csvData.trips = trips;
            csvData.plates = new Set(trips.map(t => t.plate));
            csvData.minDate = minDate.toISOString();
            csvData.maxDate = maxDate.toISOString();

            return {
                tripsCount: trips.length,
                platesCount: csvData.plates.size,
                minDate: minDate,
                maxDate: maxDate
            };
        },

        getCsvData: function() {
            return csvData;
        },
        
        getNormPlate: function(plate) {
            return normPlate(plate);
        }
    };
})();
