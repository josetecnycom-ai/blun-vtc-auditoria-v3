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
        maxDate: null,
        dateRanges: []  // Rangos de fechas individuales por CSV para filtro preciso
    };

    // ── NORMALIZAR MATRÍCULA ─────────────────────────────────
    function normPlate(p) {
        return String(p || '').replace(/[\s\-]/g, '').toUpperCase().trim();
    }

    // ── PARSEAR CSV Y FECHAS DE EXPORTACIONES UBER/HISTORIAL ──
    function parseDate(value) {
        const s = String(value || '').trim();
        if (!s) return null;
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        return null;
    }

    function normalizeHeader(value) {
        return String(value || '').replace(/^\uFEFF/, '').trim().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
    }

    function detectDelimiter(text) {
        const headerLine = String(text || '').split(/\r?\n/, 1)[0] || '';
        const counts = { ';': 0, ',': 0, '\t': 0 };
        let quoted = false;
        for (let i = 0; i < headerLine.length; i++) {
            const ch = headerLine[i];
            if (ch === '"') {
                if (quoted && headerLine[i + 1] === '"') i++;
                else quoted = !quoted;
            } else if (!quoted && Object.prototype.hasOwnProperty.call(counts, ch)) {
                counts[ch]++;
            }
        }
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }

    function parseDelimitedCsv(text) {
        const source = String(text || '').replace(/^\uFEFF/, '');
        const delimiter = detectDelimiter(source);
        const rows = [];
        let row = [], field = '', quoted = false;
        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (ch === '"') {
                if (quoted && source[i + 1] === '"') { field += '"'; i++; }
                else quoted = !quoted;
            } else if (!quoted && ch === delimiter) {
                row.push(field); field = '';
            } else if (!quoted && (ch === '\n' || ch === '\r')) {
                if (ch === '\r' && source[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
                row = [];
            } else {
                field += ch;
            }
        }
        row.push(field);
        if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
        return rows;
    }

    function buildHeaderIndex(headers) {
        const index = {};
        headers.forEach((header, i) => { index[normalizeHeader(header)] = i; });
        return index;
    }

    function cell(cols, index, header) {
        const i = index[normalizeHeader(header)];
        return i === undefined ? '' : String(cols[i] || '').trim();
    }

    function parseDistance(value) {
        const parsed = parseFloat(String(value || '0').trim().replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    // ── WRAPPER API ──────────────────────────────────────────
    function callApi(method, params) {
        return new Promise((resolve, reject) => {
            if (!api) return reject(new Error("API no inicializada"));
            api.call(method, params, resolve, reject);
        });
    }

    // ── PARSERS DE MODELOS DE VIAJES ─────────────────────────
    function parseUberCSV(rows, idx) {
        const trips = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            const estado = cell(cols, idx, 'Estado del viaje');
            if (estado.toLowerCase() !== 'completed') continue;
            const plateRaw = cell(cols, idx, 'Matrícula');
            const plate = normPlate(plateRaw);
            const reqTime = parseDate(cell(cols, idx, 'Hora de la solicitud del viaje'));
            const arrTime = parseDate(cell(cols, idx, 'Hora de llegada del viaje'));
            if (!plate || !reqTime || !arrTime) continue;
            trips.push({
                uuid: cell(cols, idx, 'UUID del viaje'),
                conductor: (cell(cols, idx, 'Nombre del conductor') + ' ' + cell(cols, idx, 'Apellido del conductor')).trim(),
                plate: plate,
                plateRaw: plateRaw,
                reqTime: reqTime,
                arrTime: arrTime,
                origin: cell(cols, idx, 'Dirección de recogida'),
                dest: cell(cols, idx, 'Dirección de destino'),
                dist: parseDistance(cell(cols, idx, 'Distancia del viaje')),
                product: cell(cols, idx, 'Tipo de producto'),
                payment: cell(cols, idx, 'Tipo de pago'),
                status: estado,
                appType: 'uber'
            });
        }
        return trips;
    }

    function parseHistoryCSV(rows, idx) {
        const trips = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            const estado = cell(cols, idx, 'Estado');
            const normalizedStatus = normalizeHeader(estado);
            if (normalizedStatus !== 'terminado' && normalizedStatus !== 'cancelacion del conductor') continue;
            const plateRaw = cell(cols, idx, 'Matrícula');
            const plate = normPlate(plateRaw);
            const reqTime = parseDate(cell(cols, idx, 'Fecha'));
            let arrTime = parseDate(cell(cols, idx, 'Tarifa finalizada'));
            if (!plate || !reqTime) continue;
            if (!arrTime) arrTime = new Date(reqTime.getTime() + 30 * 60000);
            const routeParts = cell(cols, idx, 'Ruta').split('→');
            trips.push({
                uuid: cell(cols, idx, 'Identificador individual'),
                conductor: cell(cols, idx, 'Conductor'),
                plate: plate,
                plateRaw: plateRaw,
                reqTime: reqTime,
                arrTime: arrTime,
                origin: routeParts[0] ? routeParts[0].trim() : '',
                dest: routeParts[1] ? routeParts[1].trim() : '',
                dist: parseDistance(cell(cols, idx, 'Distancia|km')),
                product: cell(cols, idx, 'Categoría'),
                payment: cell(cols, idx, 'Forma de pago'),
                status: estado,
                appType: 'history'
            });
        }
        return trips;
    }
    return {
        init: function(geotabApi) {
            api = geotabApi;
        },

        // ... (caché methods keep as is) ...
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

        getTripsAndExceptionsBatch: async function(requests, ruleId, batchSize, onProgress) {
            const output = {};
            const size = Math.max(1, Math.min(batchSize || 50, 50));
            for (let offset = 0; offset < requests.length; offset += size) {
                const batch = requests.slice(offset, offset + size);
                const calls = [];
                batch.forEach(request => {
                    calls.push(['Get', { typeName: 'Trip', search: {
                        fromDate: request.fromDate, toDate: request.toDate, deviceSearch: { id: request.device.id }
                    }, resultsLimit: 50000 }]);
                    if (ruleId) calls.push(['Get', { typeName: 'ExceptionEvent', search: {
                        ruleSearch: { id: ruleId }, deviceSearch: { id: request.device.id },
                        fromDate: request.fromDate, toDate: request.toDate
                    }, resultsLimit: 50000 }]);
                });
                if (onProgress) onProgress(Math.min(offset + batch.length, requests.length), requests.length);
                try {
                    const results = await new Promise((resolve, reject) => {
                        if (!api || typeof api.multiCall !== 'function') return reject(new Error('Geotab API multiCall no disponible.'));
                        api.multiCall(calls, resolve, reject);
                    });
                    batch.forEach((request, index) => {
                        const stride = ruleId ? 2 : 1;
                        output[request.device.id] = {
                            trips: Array.isArray(results[index * stride]) ? results[index * stride] : [],
                            exceptions: ruleId && Array.isArray(results[index * stride + 1]) ? results[index * stride + 1] : [],
                            error: null
                        };
                    });
                } catch (batchError) {
                    // If a MultiCall is rejected, fall back per device so diagnostics remain specific.
                    const fallback = await Promise.all(batch.map(async request => {
                        try {
                            const trips = await this.getTrips(request.device.id, request.fromDate, request.toDate);
                            const exceptions = ruleId ? await this.getExceptionEvents(ruleId, request.device.id, request.fromDate, request.toDate) : [];
                            return { id: request.device.id, trips, exceptions, error: null };
                        } catch (error) {
                            return { id: request.device.id, trips: [], exceptions: [], error: error.message || batchError.message };
                        }
                    }));
                    fallback.forEach(result => { output[result.id] = result; });
                }
            }
            return output;
        },
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

        getExceptionEvents: async function(ruleId, deviceId, fromDate, toDate) {
            return await callApi('Get', {
                typeName: 'ExceptionEvent',
                search: {
                    ruleSearch: { id: ruleId },
                    deviceSearch: { id: deviceId },
                    fromDate: fromDate,
                    toDate: toDate
                },
                resultsLimit: 50000
            });
        },

        // ── GESTIÓN DE CSV MÚLTIPLES Y AUTO-DETECCIÓN ────────────────────────
        parseMultipleCSVs: function(filesData) {
            if (!filesData || filesData.length === 0) throw new Error("No hay archivos para procesar.");
            
            let allTrips = [];
            // Guardamos el rango de fechas de CADA archivo por separado
            const dateRanges = [];
            
            filesData.forEach(file => {
                const rows = parseDelimitedCsv(file.text);
                if (rows.length < 2) {
                    console.warn('El archivo ' + file.name + ' está vacío o no es válido.');
                    return;
                }

                // Detectar el modelo por cabeceras; el separador puede ser coma o punto y coma.
                const idx = buildHeaderIndex(rows[0]);
                const hasTripActivity = idx['uuid del viaje'] !== undefined &&
                    idx['estado del viaje'] !== undefined &&
                    idx['hora de la solicitud del viaje'] !== undefined &&
                    idx['matricula'] !== undefined;
                const hasHistoryModel = idx['estado'] !== undefined &&
                    idx['fecha'] !== undefined &&
                    idx['tarifa finalizada'] !== undefined &&
                    idx['matricula'] !== undefined;

                let appType = 'unknown';
                let trips = [];
                if (hasTripActivity) {
                    appType = 'uber';
                    trips = parseUberCSV(rows, idx);
                } else if (hasHistoryModel) {
                    appType = 'history';
                    trips = parseHistoryCSV(rows, idx);
                } else {
                    console.warn('Formato CSV no reconocido en ' + file.name + '. Cabeceras: ' + rows[0].join(' | '));
                    return;
                }
                if (!trips.length) {
                    console.warn('El CSV ' + file.name + ' tiene cabeceras compatibles, pero no contiene filas de viaje válidas o completadas.');
                    return;
                }
                if (trips.length > 0) {
                    // Calcular y guardar el rango de fechas específico de este archivo
                    const fileDates = trips.map(t => t.reqTime).filter(Boolean);
                    const fileMin = new Date(Math.min(...fileDates));
                    const fileMax = new Date(Math.max(...fileDates));
                    fileMin.setHours(0, 0, 0, 0);
                    fileMax.setHours(23, 59, 59, 999);
                    
                    const platesInFile = new Set(trips.map(t => t.plate));
                    dateRanges.push({ min: fileMin, max: fileMax, plates: platesInFile });
                }

                trips.forEach(t => t.appSource = appType);
                allTrips = allTrips.concat(trips);
            });

            // Si se cargan dos exportaciones equivalentes, evita contar dos veces el mismo UUID.
            const uniqueTrips = new Map();
            allTrips.forEach(trip => {
                const uuid = String(trip.uuid || '').trim();
                const key = uuid
                    ? trip.appType + '|' + uuid
                    : [trip.appType, trip.plate, trip.reqTime && trip.reqTime.getTime(), trip.arrTime && trip.arrTime.getTime()].join('|');
                if (!uniqueTrips.has(key)) uniqueTrips.set(key, trip);
            });
            allTrips = Array.from(uniqueTrips.values());
            if (allTrips.length === 0) throw new Error("No se encontraron viajes válidos en los archivos cargados.");

            const allDates = allTrips.map(t => t.reqTime).filter(Boolean);
            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));
            minDate.setHours(0,0,0,0);
            maxDate.setHours(23,59,59,999);

            csvData.trips = allTrips;
            csvData.plates = new Set(allTrips.map(t => t.plate));
            csvData.minDate = minDate.toISOString();
            csvData.maxDate = maxDate.toISOString();
            // ✔ Guardamos los rangos individuales para filtrar Geotab después
            csvData.dateRanges = dateRanges;

            return {
                tripsCount: allTrips.length,
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
