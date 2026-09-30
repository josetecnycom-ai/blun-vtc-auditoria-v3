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
            
            // Actualizar dropdown de filtro
            const sel = document.getElementById('filterVehicle');
            sel.innerHTML = '<option value="all">Todos</option>';
            const plates = Array.from(DataManager.getCsvData().plates).sort();
            plates.forEach(p => {
                const o = document.createElement('option');
                o.value = p; o.textContent = p;
                sel.appendChild(o);
            });

            document.getElementById('btnRun').disabled = false;
        } catch (err) {
            alert("Error al procesar archivos: " + err.message);
        }
    }

    async function runAudit() {
        UI.showLoading("Obteniendo vehículos y usuarios...");
        
        try {
            const users = await DataManager.getUsers();
            const devicesCache = await DataManager.getDevices();
            const csvData = DataManager.getCsvData();

            // Buscar vehículos con coincidencia flexible (igual que V2)
            const csvPlates = csvData.plates;
            const targetDevices = [];
            Object.values(devicesCache.byId).forEach(d => {
                const normName  = DataManager.getNormPlate(d.name || '');
                const normPlate = DataManager.getNormPlate(d.licensePlate || '');
                const matchedCsvPlate = Array.from(csvPlates).find(p => normName.includes(p) || normPlate.includes(p));
                if (matchedCsvPlate) {
                    d._matchedCsvPlate = matchedCsvPlate;
                    targetDevices.push(d);
                }
            });

            if (targetDevices.length === 0) {
                UI.showError("No se encontraron vehículos en Geotab que coincidan con las matrículas del CSV.");
                return;
            }

            const fromDate = csvData.minDate;
            const toDate = csvData.maxDate;
            const tolerance = parseInt(document.getElementById('tolerance').value) || 5;
            const minDist = 0;

            // 1. Descargar Viajes y Eventos
            let allTrips = [];
            let allEvents = [];
            const cameraEventsByDevice = {};
            const cameraUnavailableByDevice = {};
            const ruleId = RuleManager.hasParadaRapidaRule() ? RuleManager.getParadaRapidaId() : null;

            // Asegurar que tenemos dateRanges
            const dateRanges = csvData.dateRanges && csvData.dateRanges.length > 0
                ? csvData.dateRanges
                : [{ min: new Date(fromDate), max: new Date(toDate), plates: new Set(Array.from(csvData.plates)) }];

            for (let i=0; i<targetDevices.length; i++) {
                const dev = targetDevices[i];
                const plate = dev._matchedCsvPlate;
                
                // Encontrar los rangos de fechas en los que este vehículo específico tiene datos de CSV
                const validRanges = dateRanges.filter(r => r.plates && r.plates.has(plate));
                
                if (validRanges.length === 0) {
                    console.warn(`El vehículo ${plate} no tiene rangos de fechas válidos, omitiendo descarga.`);
                    continue; 
                }

                // Calcular la fecha mínima y máxima absoluta para este vehículo
                const devMinDate = new Date(Math.min(...validRanges.map(r => r.min.getTime()))).toISOString();
                const devMaxDate = new Date(Math.max(...validRanges.map(r => r.max.getTime()))).toISOString();

                UI.updateLoading(`Descargando datos... vehículo ${i+1}/${targetDevices.length}: ${dev.name}`);
                try {
                    // Descargar solo el periodo en el que este vehículo trabajó
                    const trips = await DataManager.getTrips(dev.id, devMinDate, devMaxDate);
                    trips.forEach(t => t._device = dev);
                    allTrips = allTrips.concat(trips);

                    try {
                        UI.updateLoading(`Consultando ocupación de cámara... vehículo ${i+1}/${targetDevices.length}: ${dev.name}`);
                        const cameraResult = await PassengerCamera.fetchForDevice(dev, devMinDate, devMaxDate);
                        cameraEventsByDevice[dev.id] = cameraResult.events;
                        if (!cameraResult.available) cameraUnavailableByDevice[dev.id] = cameraResult.reason;
                    } catch (cameraError) {
                        cameraUnavailableByDevice[dev.id] = cameraError.message || 'Error consultando eventos de cámara.';
                        console.warn('Error consultando eventos de cámara para', dev.id, cameraError);
                    }
                    if (ruleId) {
                        try {
                            const devEvents = await DataManager.getExceptionEvents(ruleId, dev.id, devMinDate, devMaxDate);
                            allEvents = allEvents.concat(devEvents);
                        } catch (stopError) {
                            console.warn('Error descargando eventos de Parada Rápida', dev.id, stopError);
                        }
                    }
                } catch(e) {
                    console.warn("Error descargando datos del vehiculo", dev.id, e);
                }
            }

            const geotabFiltered = allTrips.filter(t => {

                const tStart = new Date(t.start || t.startTime).getTime();
                const tStop  = new Date(t.stop  || t.stopTime).getTime();
                const plate = t._device._matchedCsvPlate;
                
                // Incluir el trip solo si cae dentro de alguno de los rangos ESPECÍFICOS donde el vehículo tiene CSV
                // Esto descarta viajes en los huecos (ej. si trabajó en mayo y julio, descarta los viajes de junio)
                return dateRanges.some(r => r.plates && r.plates.has(plate) && tStart <= r.max.getTime() && tStop >= r.min.getTime());
            });

            // 2. Motor de Paradas
            if (ruleId) {
                UI.updateLoading("Calculando duraciones reales de las paradas...");
                StopAnalyzer.analyzeTrips(geotabFiltered, allEvents);
            } else {
                console.warn("No se analizan paradas porque no se encontró la regla");
                geotabFiltered.forEach(t => t._stopAnalysis = { quickStops:0, totalStopTime:0, maxStop:0, stopLocations:[]});
            }

            const cameraTolerance = Math.max(0, parseInt(document.getElementById('cameraTolerance').value) || 0) * 60000;
            PassengerCamera.analyzeTrips(geotabFiltered, cameraEventsByDevice, allEvents, cameraUnavailableByDevice, cameraTolerance);
            UI.updateLoading("Comparando ocupación detectada con viajes CSV...");
            
            // 3. Cruce con CSV y Motor de Riesgo
            const tolMs = tolerance * 60 * 1000;
            const enriched = geotabFiltered.map(t => {
                const dev = t._device;
                // Usar la placa cruzada del dispositivo (igual que V2)
                const plate = dev._matchedCsvPlate;
                const gStart = new Date(t.start || t.startTime);
                const gStop = new Date(t.stop || t.stopTime);
                const gDist = t.distance || 0; // ya en km

                let driverName = "Sin conductor";
                if (t.driver && t.driver.id && t.driver.id !== "UnknownDriverId" && t.driver.id !== "NoDriverId") {
                    driverName = users[t.driver.id] || t.driver.id;
                }

                // Cruce con overlap (misma lógica V2 validada con matchedCSVTrips)
                const matchedCSVTrips = csvData.trips.filter(c => {
                    if (c.plate !== plate) return false;
                    const maxStart = Math.max(gStart.getTime() - tolMs, c.reqTime.getTime());
                    const minEnd   = Math.min(gStop.getTime()  + tolMs, c.arrTime.getTime());
                    return minEnd > maxStart;
                });

                const csvDist = matchedCSVTrips.length > 0
                    ? matchedCSVTrips.reduce((s, c) => s + (c.dist || 0), 0)
                    : null;

                let tripData = {
                    gId: t.id,
                    gStart: gStart, gStop: gStop,
                    gDist: +gDist.toFixed(2),
                    gDur: Math.round((gStop - gStart) / 60000),
                    plate: plate,
                    plateOrig: dev.name,
                    deviceId: dev.id,
                    deviceName: dev.name,
                    geotabDriverName: driverName,
                    matched: matchedCSVTrips.length > 0,
                    csvCount: matchedCSVTrips.length,
                    csvDist: csvDist !== null ? +csvDist.toFixed(2) : null,
                    _stopAnalysis: t._stopAnalysis,
                    _passengerAnalysis: t._passengerAnalysis,
                    _matchedCsvTrips: matchedCSVTrips
                };

                // Motor de Riesgo
                tripData.audit = RiskEngine.evaluateTrip(tripData);
                
                return tripData;
            });

            // Guardar para el filtrado sin reconsultar API
            UI._cachedData = { enriched, csvData, tolerance, minDist, targetDevices };

            // 4. Render final
            UI.renderResults(enriched, csvData, tolerance, minDist, targetDevices);

        } catch (err) {
            console.error(err);
            UI.showError("Error durante la auditoría: " + err.message);
        }
    }
};
