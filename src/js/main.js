// main.js
// Orquestador principal y registro del Add-In en Geotab

if (typeof geotab === 'undefined') {
    window.geotab = { addin: {} };
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('resultsArea').innerHTML =
            '<div class="state"><p>Modo standalone — conecta a Geotab para datos reales.</p></div>';
    });
}

// Registro del addin con el key definido en el JSON
geotab.addin.blunvtcauditoria = function(api, state) {
    return {
        initialize: function(geotabApi, geotabState, callback) {
            // Inicializar capa de datos
            DataManager.init(geotabApi);
            
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
                    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
                });
                dropZone.addEventListener('click', () => document.getElementById('fileInput').click());
            }

            document.getElementById('btnRun').addEventListener('click', runAudit);
            document.getElementById('btnExport').addEventListener('click', () => {
                UI.exportExcel(DataManager.getCsvData());
            });

            // Avisar a Geotab que estamos listos
            callback();
        },
        focus: async function(geotabApi, geotabState) {
            // Buscar la regla en background al abrir el addin
            await RuleManager.init();
        },
        blur: function() {}
    };

    function handleFileSelect(e) {
        if (e.target.files[0]) processFile(e.target.files[0]);
    }

    function processFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const stats = DataManager.parseCSV(e.target.result, file.name);
                document.getElementById('uploadLabel').innerHTML = 
                    `<strong style="color:var(--ok);">✓ ${file.name}</strong> — ${stats.tripsCount.toLocaleString('es')} viajes cargados`;
                
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
                alert("Error al parsear el CSV: " + err.message);
            }
        };
        reader.readAsText(file, 'utf-8');
    }

    async function runAudit() {
        UI.showLoading("Obteniendo vehículos y usuarios...");
        
        try {
            const users = await DataManager.getUsers();
            const devicesCache = await DataManager.getDevices();
            const csvData = DataManager.getCsvData();

            const targetDevices = Array.from(csvData.plates)
                .map(p => devicesCache.byPlate[p])
                .filter(Boolean);

            if (targetDevices.length === 0) {
                UI.showError("No se encontraron vehículos en Geotab que coincidan con las matrículas del CSV.");
                return;
            }

            const fromDate = csvData.minDate;
            const toDate = csvData.maxDate;
            const tolerance = parseInt(document.getElementById('tolerance').value) || 5;
            const minDist = parseFloat(document.getElementById('minDist').value) || 0.5;

            // 1. Descargar Viajes
            let allTrips = [];
            for (let i=0; i<targetDevices.length; i++) {
                const dev = targetDevices[i];
                UI.updateLoading(`Descargando viajes... vehículo ${i+1}/${targetDevices.length}: ${dev.name}`);
                try {
                    const trips = await DataManager.getTrips(dev.id, fromDate, toDate);
                    trips.forEach(t => t._device = dev);
                    allTrips = allTrips.concat(trips);
                } catch(e) {
                    console.warn("Error descargando viajes del vehiculo", dev.id, e);
                }
            }

            const geotabFiltered = allTrips.filter(t => {
                return ((t.distance || 0) / 1000) >= minDist;
            });

            // 2. Motor de Paradas
            if (RuleManager.hasParadaRapidaRule()) {
                UI.updateLoading("Descargando eventos de paradas rápidas de Geotab...");
                const ruleId = RuleManager.getParadaRapidaId();
                let allEvents = [];
                try {
                    allEvents = await DataManager.getExceptionEvents(ruleId, fromDate, toDate);
                } catch (e) {
                    console.error("Error al obtener eventos", e);
                }
                
                UI.updateLoading("Calculando duraciones reales de las paradas...");
                StopAnalyzer.analyzeTrips(geotabFiltered, allEvents);
            } else {
                console.warn("No se analizan paradas porque no se encontró la regla");
                geotabFiltered.forEach(t => t._stopAnalysis = { quickStops:0, totalStopTime:0, maxStop:0, stopLocations:[]});
            }

            UI.updateLoading("Cruzando datos y calculando Índice de Confianza...");
            
            // 3. Cruce con CSV y Motor de Riesgo
            const tolMs = tolerance * 60 * 1000;
            const enriched = geotabFiltered.map(t => {
                const dev = t._device;
                const plate = DataManager.getNormPlate(dev.name);
                const gStart = new Date(t.start || t.startTime);
                const gStop = new Date(t.stop || t.stopTime);
                const gDist = (t.distance || 0) / 1000;

                let driverName = "Desconocido";
                if (t.driver && t.driver.id !== "UnknownDriverId") {
                    driverName = users[t.driver.id] || t.driver.id;
                }

                // Cruce (Misma lógica V2 validada)
                const match = csvData.trips.find(c => {
                    if (c.plate !== plate) return false;
                    const isAfterStart = gStart >= new Date(c.reqTime.getTime() - tolMs);
                    const isBeforeEnd = gStop <= new Date(c.arrTime.getTime() + tolMs);
                    return isAfterStart && isBeforeEnd;
                });

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
                    matched: !!match,
                    csvUUID: match ? match.uuid : null,
                    csvDist: match ? match.dist : null,
                    _stopAnalysis: t._stopAnalysis
                };

                // Motor de Riesgo
                tripData.audit = RiskEngine.evaluateTrip(tripData);
                
                return tripData;
            });

            // 4. Render final
            UI.renderResults(enriched, csvData, tolerance, minDist);

        } catch (err) {
            console.error(err);
            UI.showError("Error durante la auditoría: " + err.message);
        }
    }
};
