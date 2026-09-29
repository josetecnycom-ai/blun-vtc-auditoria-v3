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

    // ── PARSERS ESPECÍFICOS POR APP ──────────────────────────
    function parseUberCSV(lines, idx) {
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
                status: estado,
                appType: 'uber'
            });
        }
        return trips;
    }

    function parseBoltCSV(lines, idx) {
        const trips = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(';');
            const estado = (cols[idx['Estado']] || '').trim();
            
            // Requerimiento: Analizar "Terminado" y "Cancelación del conductor"
            if (estado !== 'Terminado' && estado !== 'Cancelación del conductor') continue;

            const plate = normPlate(cols[idx['Matrícula']]);
            const reqStr = (cols[idx['Fecha']] || '').trim(); 
            const arrStr = (cols[idx['Tarifa finalizada']] || '').trim(); 

            if (!plate || !reqStr) continue;

            let reqTimeParsed = parseDate(reqStr);
            let arrTimeParsed = parseDate(arrStr);
            if (!reqTimeParsed) continue;
            
            // Si no hay hora de llegada (por cancelación), estimamos una ventana de 30 mins
            // para que el motor de riesgo pueda buscar viajes de Geotab en esa franja.
            if (!arrTimeParsed) {
                arrTimeParsed = new Date(reqTimeParsed.getTime() + 30 * 60000);
            }

            let ruta = cols[idx['Ruta']] || '';
            let origin = ruta.split('→')[0] ? ruta.split('→')[0].trim() : '';
            let dest = ruta.split('→')[1] ? ruta.split('→')[1].trim() : '';

            trips.push({
                uuid: cols[idx['Identificador individual']],
                conductor: cols[idx['Conductor']] || '',
                plate: plate,
                plateRaw: cols[idx['Matrícula']],
                reqTime: reqTimeParsed,
                arrTime: arrTimeParsed,
                origin:  origin,
                dest:    dest,
                dist:    parseFloat((cols[idx['Distancia|km']] || '0').replace(',','.')),
                product: cols[idx['Categoría']] || '',
                payment: cols[idx['Forma de pago']] || '', // "Efectivo" o "En app"
                status: estado,
                appType: 'bolt'
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
                let text = file.text.replace(/^\uFEFF/, '');
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 2) {
                    console.warn(`El archivo ${file.name} está vacío o no es válido.`);
                    return;
                }

                // Auto-detección por cabeceras
                const headerLine = lines[0];
                const header = headerLine.split(';');
                const idx = {};
                header.forEach((h, i) => { idx[h.trim()] = i; });

                let appType = 'unknown';
                if (idx['UUID del viaje'] !== undefined || headerLine.includes('UUID del viaje') || headerLine.includes('Estado del viaje')) {
                    appType = 'uber';
                } else if (idx['Identificador individual'] !== undefined || headerLine.includes('Identificador individual') || headerLine.includes('Tarifa finalizada')) {
                    appType = 'bolt';
                }

                let trips = [];
                if (appType === 'uber') {
                    trips = parseUberCSV(lines, idx);
                } else if (appType === 'bolt') {
                    trips = parseBoltCSV(lines, idx);
                } else {
                    console.warn(`No se pudo detectar el formato de ${file.name}. Formato no reconocido.`);
                    return; // Skip este archivo
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
