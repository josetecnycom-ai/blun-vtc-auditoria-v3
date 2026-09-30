// main.js
// Orquestador principal y registro del Add-In en Geotab

if (typeof geotab === 'undefined') {
    window.geotab = { addin: {} };
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('resultsArea').innerHTML =
            '<div class="state"><p>Modo standalone — conecta a Geotab para datos reales.</p></div>';
    });
}

// Variables globales de sesión (necesarias para navegar al mapa)
let _globalState = null;
let _serverStr = 'my.geotab.com';
let _databaseStr = '';

// Función global para navegar al mapa — usando la estructura EXACTA de la URL funcional
function navigateToTrip(event, deviceId, fromDate, toDate) {
    if (event) event.preventDefault();
    if (_globalState && typeof _globalState.gotoPage === 'function') {
        _globalState.gotoPage('tripsHistory', {
            devices: [deviceId], // Array de strings con el ID: !('b379')
            dateRange: {
                startDate: fromDate,
                endDate: toDate,
                label: 'Custom'
            },
            fromDate: fromDate,
            toDate: toDate
        });
    } else {
        const url = `https://${_serverStr}/${_databaseStr}/#tripsHistory,dateRange:(endDate:'${toDate}',label:Custom,startDate:'${fromDate}'),devices:!('${deviceId}'),fromDate:'${fromDate}',toDate:'${toDate}'`;
        window.open(url, '_blank');
    }
}

// Registro del addin con el key definido en el JSON
geotab.addin.blunvtcauditoria = function(api, state) {
    return {
        initialize: function(geotabApi, geotabState, callback) {
            // Guardar estado de sesión para la navegación al mapa
            _globalState = geotabState;

            // Obtener servidor y base de datos de la sesión
            geotabApi.getSession(function(session) {
                if (session) {
                    _serverStr = session.server || 'my.geotab.com';
                    _databaseStr = session.database || '';
                    const dbBadge = document.getElementById('dbNameBadge');
                    if (dbBadge) dbBadge.textContent = _databaseStr || 'blun';
                }
            });

            // Inicializar capa de datos
            DataManager.init(geotabApi);
            PassengerCamera.init(geotabApi);
            setDefaultDates();
            DataManager.getDevices().then(populateDeviceOptions).catch(e => console.warn('No se pudieron cargar vehículos', e));
            document.getElementById('dateFrom').addEventListener('change', updateRunState);
            document.getElementById('dateTo').addEventListener('change', updateRunState);
            
            // Binding de eventos UI
            document.getElementById('fileInput').addEventListener('change', handleFileSelect);
            
            // Drag & Drop
            const dropZone = document.getElementById('dropZone');
            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
                dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag'); });
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('drag');
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        processFiles(e.dataTransfer.files);
                    }
                });
                dropZone.addEventListener('click', () => document.getElementById('fileInput').click());
            }

            document.getElementById('btnRun').addEventListener('click', runAudit);
            document.getElementById('btnExport').addEventListener('click', () => {
                UI.exportExcel(DataManager.getCsvData());
            });
            const btnPdf = document.getElementById('btnExportPDF');
            if (btnPdf) {
                btnPdf.addEventListener('click', () => {
                    UI.exportPDF(DataManager.getCsvData());
                });
            }

            // Avisar a Geotab que estamos listos
            callback();
        },
        focus: async function(geotabApi, geotabState) {
            _globalState = geotabState;
            // Buscar la regla en background al abrir el addin
            await RuleManager.init();
        },
        blur: function() {}
    };

    function toDateInputValue(value) {
        const date = new Date(value);
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    }

    function setDefaultDates() {
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - 6);
        document.getElementById('dateFrom').value = toDateInputValue(from);
        document.getElementById('dateTo').value = toDateInputValue(to);
    }

    function updateRunState() {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;
        document.getElementById('btnRun').disabled = !from || !to || from > to;
    }

    function populateDeviceOptions(devicesCache) {
        const sel = document.getElementById('filterVehicle');
        const selected = sel.value;
        sel.innerHTML = '<option value="all">Todos</option>';
        Object.values(devicesCache.byId).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es')).forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.name || device.id;
            sel.appendChild(option);
        });
        if (Array.from(sel.options).some(option => option.value === selected)) sel.value = selected;
    }
    function handleFileSelect(e) {
        if (e.target.files && e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    }

    async function processFiles(fileList) {
        const files = Array.from(fileList);
        try {
            const fileDataPromises = files.map(file => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve({ name: file.name, text: e.target.result });
                    reader.onerror = () => reject(new Error(`Error leyendo ${file.name}`));
                    reader.readAsText(file, 'utf-8');
                });
            });

            const filesData = await Promise.all(fileDataPromises);
            const stats = DataManager.parseMultipleCSVs(filesData);

            const filesStr = files.length === 1 ? files[0].name : `${files.length} archivos combinados`;
            document.getElementById('uploadLabel').innerHTML = 
                `<strong style="color:var(--ok);">✓ ${filesStr}</strong> — ${stats.tripsCount.toLocaleString('es')} viajes cargados`;
            
            document.getElementById('dateFrom').value = toDateInputValue(stats.minDate);
            document.getElementById('dateTo').value = toDateInputValue(stats.maxDate);
            document.getElementById('csvToleranceGroup').style.display = 'flex';
            updateRunState();
        } catch (err) {
            alert("Error al procesar archivos: " + err.message);
        }
    }

    async function runAudit() {
        const auditStartedAt = Date.now();
        UI.showLoading('Preparando período y vehículos...');
        try {
            const devicesCache = await DataManager.getDevices();
            populateDeviceOptions(devicesCache);
            const csvData = DataManager.getCsvData();
            const hasCsv = !!(csvData.trips && csvData.trips.length);
            const fromInput = document.getElementById('dateFrom').value;
            const toInput = document.getElementById('dateTo').value;
            if (!fromInput || !toInput || fromInput > toInput) throw new Error('Selecciona un rango de fechas válido.');
            const windowStart = new Date(fromInput + 'T00:00:00').getTime();
            const windowEnd = new Date(toInput + 'T23:59:59.999').getTime();
            const fromDate = new Date(windowStart).toISOString();
            const toDate = new Date(windowEnd).toISOString();
            const selectedDevice = document.getElementById('filterVehicle').value;
            const csvPlates = csvData.plates || new Set();
            const devices = Object.values(devicesCache.byId);
            const targetDevices = [];

            devices.forEach(device => {
                if (selectedDevice !== 'all' && device.id !== selectedDevice) return;
                if (hasCsv) {
                    const normName = DataManager.getNormPlate(device.name || '');
                    const normPlate = DataManager.getNormPlate(device.licensePlate || '');
                    const matchedCsvPlate = Array.from(csvPlates).find(plate => normName.includes(plate) || normPlate.includes(plate));
                    if (!matchedCsvPlate) return;
                    device._matchedCsvPlate = matchedCsvPlate;
                } else {
                    device._matchedCsvPlate = DataManager.getNormPlate(device.licensePlate || device.name || '');
                }
                targetDevices.push(device);
            });
            if (!targetDevices.length) throw new Error(hasCsv
                ? 'No hay vehículos seleccionados que coincidan con las matrículas del CSV.'
                : 'No hay vehículos disponibles para analizar.');

            const tolerance = hasCsv ? (parseInt(document.getElementById('tolerance').value) || 5) : 0;
            const cameraTolerance = Math.max(0, parseInt(document.getElementById('cameraTolerance').value) || 0) * 60000;
            const ruleId = RuleManager.hasParadaRapidaRule() ? RuleManager.getParadaRapidaId() : null;
            const dateRanges = hasCsv && csvData.dateRanges && csvData.dateRanges.length
                ? csvData.dateRanges
                : [{ min: new Date(windowStart), max: new Date(windowEnd), plates: new Set(Array.from(csvPlates)) }];
            const requests = [];
            for (const device of targetDevices) {
                let deviceStart = windowStart, deviceEnd = windowEnd;
                if (hasCsv) {
                    const deviceRanges = dateRanges.filter(range => range.plates && range.plates.has(device._matchedCsvPlate));
                    if (!deviceRanges.length) continue;
                    deviceStart = Math.max(windowStart, Math.min(...deviceRanges.map(range => range.min.getTime())));
                    deviceEnd = Math.min(windowEnd, Math.max(...deviceRanges.map(range => range.max.getTime())));
                    if (deviceStart > deviceEnd) continue;
                }
                requests.push({ device, fromDate: new Date(deviceStart).toISOString(), toDate: new Date(deviceEnd).toISOString() });
            }
            if (!requests.length) throw new Error('No hay vehículos con viajes dentro del período seleccionado.');
            UI.updateLoading(`Descargando viajes y paradas en lotes para ${requests.length} vehículos...`);
            const [vehicleData, cameraResult] = await Promise.all([
                DataManager.getTripsAndExceptionsBatch(requests, ruleId, 50, (done, total) => {
                    UI.updateLoading(`Consultas agrupadas: ${done}/${total} vehículos...`);
                }),
                PassengerCamera.fetchForDevices(requests.map(request => request.device), fromDate, toDate)
            ]);
            const allTrips = [];
            const allEvents = [];
            requests.forEach(request => {
                const result = vehicleData[request.device.id];
                const diagnostic = cameraResult.diagnosticsByDevice[request.device.id];
                if (result && result.error) {
                    if (diagnostic) diagnostic.tripQueryError = result.error;
                    console.warn('Error descargando viajes/paradas de', request.device.name, result.error);
                    return;
                }
                (result && result.trips || []).forEach(trip => { trip._device = request.device; });
                allTrips.push(...(result && result.trips || []));
                allEvents.push(...(result && result.exceptions || []));
            });
            const tripsInWindow = allTrips.filter(trip => {
                const start = new Date(trip.start || trip.startTime).getTime();
                const stop = new Date(trip.stop || trip.stopTime).getTime();
                const plate = trip._device._matchedCsvPlate;
                if (start > windowEnd || stop < windowStart) return false;
                if (!hasCsv) return true;
                return dateRanges.some(range => range.plates && range.plates.has(plate) && start <= range.max.getTime() && stop >= range.min.getTime());
            });
            if (ruleId) StopAnalyzer.analyzeTrips(tripsInWindow, allEvents);
            else tripsInWindow.forEach(trip => { trip._stopAnalysis = { quickStops: 0, totalStopTime: 0, maxStop: 0, stopLocations: [] }; });
            PassengerCamera.analyzeTrips(tripsInWindow, cameraResult, allEvents, cameraTolerance);
            UI.updateLoading(hasCsv ? 'Comparando ocupación con el CSV...' : 'Preparando resumen de ocupación...');

            const toleranceMs = tolerance * 60000;
            const enriched = tripsInWindow.map(trip => {
                const device = trip._device;
                const start = new Date(trip.start || trip.startTime);
                const stop = new Date(trip.stop || trip.stopTime);
                const csvMatches = hasCsv ? csvData.trips.filter(csvTrip => {
                    if (csvTrip.plate !== device._matchedCsvPlate) return false;
                    return Math.min(stop.getTime() + toleranceMs, csvTrip.arrTime.getTime()) >
                        Math.max(start.getTime() - toleranceMs, csvTrip.reqTime.getTime());
                }) : [];
                const row = {
                    gId: trip.id, gStart: start, gStop: stop, gDist: +(trip.distance || 0).toFixed(2),
                    gDur: Math.round((stop - start) / 60000), plate: device._matchedCsvPlate,
                    plateOrig: device.name, deviceId: device.id, deviceName: device.name,
                    hasCsv, matched: csvMatches.length > 0, csvCount: csvMatches.length,
                    _stopAnalysis: trip._stopAnalysis, _passengerAnalysis: trip._passengerAnalysis,
                    _matchedCsvTrips: csvMatches
                };
                row.audit = RiskEngine.evaluateTrip(row);
                return row;
            });
            const periodData = Object.assign({}, csvData, { minDate: fromDate, maxDate: toDate, elapsedSeconds: ((Date.now() - auditStartedAt) / 1000).toFixed(1) });
            UI._cachedData = { enriched, csvData: periodData, hasCsv, tolerance, targetDevices };
            UI.renderResults(enriched, periodData, tolerance, 0, targetDevices, hasCsv, cameraResult);
        } catch (error) {
            console.error(error);
            UI.showError('Error durante el análisis: ' + error.message);
        }
    }
};
