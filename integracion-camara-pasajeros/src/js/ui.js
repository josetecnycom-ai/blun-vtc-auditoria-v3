// ui.js
// Maneja todo el renderizado visual y eventos DOM

const UI = (function() {

    let currentTrips = [];
    let _targetDevices = [];
    let _chartInstances = []; // To store Chart.js instances for cleanup

    // ── FORMATTERS ─────────────────────────────────────────────────
    function fmtDate(d) {
        if (!d) return '';
        return d.toLocaleDateString('es-ES', {day:'2-digit',month:'2-digit',year:'numeric'});
    }
    function fmtTime(d) {
        if (!d) return '';
        return d.toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
    }
    function fmtDateShort(d) {
        if (!d) return '';
        return d.toLocaleDateString('es-ES', {day:'2-digit',month:'2-digit'});
    }
    function fmtDur(s) {
        if (!s || s === 0) return '0s';
        const m = Math.floor(s / 60);
        const sec = Math.round(s % 60);
        if (m > 0) return `${m}m ${sec > 0 ? sec + 's' : ''}`.trim();
        return `${sec}s`;
    }

    // ── DOM UTILS ───────────────────────────────────────────────────
    function showLoading(msg) {
        document.getElementById('resultsArea').innerHTML =
            `<div class="state"><div class="spinner"></div><p class="progress-msg">${msg}</p></div>`;
        const btnExp = document.getElementById('btnExport');
        const btnPdf = document.getElementById('btnExportPDF');
        if (btnExp) btnExp.style.display = 'none';
        if (btnPdf) btnPdf.style.display = 'none';
    }
    function updateLoading(msg) {
        const p = document.querySelector('.progress-msg');
        if (p) p.textContent = msg;
    }
    function showError(msg) {
        document.getElementById('resultsArea').innerHTML =
            `<div class="state"><p style="color:var(--danger)">${msg}</p></div>`;
    }

    return {
        showLoading, updateLoading, showError,
        _cachedData: null,

        // ── RENDER PRINCIPAL ─────────────────────────────────────
        renderResults: function(trips, periodData, tolerance, cameraTolerance, targetDevices, hasCsv) {
            currentTrips = trips;
            if (targetDevices) _targetDevices = targetDevices;
            const filter = document.getElementById('filterVehicle');
            const data = filter && filter.value !== 'all' ? trips.filter(t => t.deviceId === filter.value) : trips;
            const occupied = data.filter(t => t._passengerAnalysis && t._passengerAnalysis.hasPassenger);
            const noEvent = data.filter(t => t._passengerAnalysis && t._passengerAnalysis.available && !t._passengerAnalysis.hasPassenger);
            const unavailable = data.filter(t => !t._passengerAnalysis || !t._passengerAnalysis.available);
            const registered = occupied.filter(t => t.matched);
            const frauds = hasCsv ? occupied.filter(t => !t.matched) : [];
            const eventMap = new Map();
            data.forEach(t => (t._passengerAnalysis && t._passengerAnalysis.receivedEvents || []).forEach(e => {
                const key = `${t.deviceId}:${e.id || e.eventStart}`;
                if (!eventMap.has(key)) eventMap.set(key, e);
            }));
            const byVehicle = new Map();
            data.forEach(t => {
                const key = t.deviceId;
                if (!byVehicle.has(key)) byVehicle.set(key, { name: t.plateOrig || t.deviceName, trips: [], deviceId: key });
                byVehicle.get(key).trips.push(t);
            });
            const vehicles = Array.from(byVehicle.values()).sort((a,b) => a.name.localeCompare(b.name, 'es'));
            const period = `${fmtDateShort(new Date(periodData.minDate))} – ${fmtDateShort(new Date(periodData.maxDate))}`;
            const html = [];
            html.push(`
                <div class="info-bar">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Período: ${period} · ${data.length} viajes Geotab · ${hasCsv ? `CSV cargado, tolerancia ±${tolerance} min` : 'modo resumen de cámara'} · Cámara ±${document.getElementById('cameraTolerance').value} min
                </div>
                ${unavailable.length ? `<div class="info-bar" style="background:var(--warn-dim);color:var(--warn);border-color:var(--warn);">Sin cobertura de cámara en ${unavailable.length} viaje(s); no se clasifican como “sin ocupación”.</div>` : ''}
                ${eventMap.size === 0 && data.length > unavailable.length ? `<div class="info-bar">La cámara se consultó correctamente, pero no se recibieron eventos Passenger.Disallowed. Si el período es anterior a la activación de la regla, es normal.</div>` : ''}
                ${!hasCsv ? `<div class="info-bar">“Sin evento detectado” solo cuenta viajes con cámara disponible; no confirma por sí solo que viajaran sin pasajeros.</div>` : ''}
                <div class="metrics" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));">
                    ${hasCsv ? `
                        <div class="metric m-accent"><div class="metric-label">Eventos de ocupación recibidos</div><div class="metric-value">${eventMap.size}</div></div>
                        <div class="metric m-ok"><div class="metric-label">Viajes ocupados con CSV</div><div class="metric-value">${registered.length}</div></div>
                        <div class="metric m-danger"><div class="metric-label">Ocupación sin registro</div><div class="metric-value">${frauds.length}</div></div>
                    ` : `
                        <div class="metric m-accent"><div class="metric-label">Viajes analizados</div><div class="metric-value">${data.length}</div></div>
                        <div class="metric m-danger"><div class="metric-label">Viajes con ocupación</div><div class="metric-value">${occupied.length}</div></div>
                        <div class="metric m-ok"><div class="metric-label">Sin evento detectado</div><div class="metric-value">${noEvent.length}</div><div class="metric-sub">con cámara disponible</div></div>
                    `}
                </div>
            `);
            html.push(UI.generateHeatmap(hasCsv ? frauds : occupied, hasCsv ? 'Ocupación detectada sin coincidencia CSV' : 'Viajes con ocupación detectada'));
            html.push(`
                <div class="table-card">
                    <div class="table-toolbar"><span class="table-title">Resumen por vehículo</span></div>
                    ${vehicles.length ? `<div class="table-wrap"><table><thead><tr>
                        <th>Vehículo</th><th>Viajes Geotab</th><th>Con ocupación</th><th>Sin evento detectado</th><th>Sin cobertura cámara</th>${hasCsv ? '<th>Ocupación sin CSV</th>' : ''}
                    </tr></thead><tbody>${vehicles.map(v => {
                        const withOccupancy = v.trips.filter(t => t._passengerAnalysis && t._passengerAnalysis.hasPassenger).length;
                        const withoutEvent = v.trips.filter(t => t._passengerAnalysis && t._passengerAnalysis.available && !t._passengerAnalysis.hasPassenger).length;
                        const noCoverage = v.trips.length - withOccupancy - withoutEvent;
                        const suspicious = hasCsv ? v.trips.filter(t => t._passengerAnalysis && t._passengerAnalysis.hasPassenger && !t.matched).length : 0;
                        return `<tr><td><strong>${v.name}</strong></td><td>${v.trips.length}</td><td>${withOccupancy}</td><td>${withoutEvent}</td><td>${noCoverage}</td>${hasCsv ? `<td>${suspicious}</td>` : ''}</tr>`;
                    }).join('')}</tbody></table></div>` : `<div class="state"><p>No se encontraron viajes Geotab en este período para los vehículos seleccionados.</p></div>`}
                    <div class="table-footer"><span>${vehicles.length} vehículos · ${data.length} viajes analizados</span></div>
                </div>
            `);
            if (hasCsv) html.push(`
                <div class="table-card" style="margin-top:16px;">
                    <div class="table-toolbar"><span class="table-title">Ocupación detectada sin coincidencia en CSV</span></div>
                    ${frauds.length ? `<div class="table-wrap"><table><thead><tr><th>Vehículo</th><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Eventos</th><th></th></tr></thead><tbody>
                        ${frauds.slice().sort((a,b) => b.gStart - a.gStart).map(t => `<tr><td><strong>${t.plateOrig}</strong></td><td>${fmtDate(t.gStart)}</td><td>${fmtTime(t.gStart)}</td><td>${fmtTime(t.gStop)}</td><td>${t._passengerAnalysis.events.length}</td><td><a class="trip-link" href="#" onclick="navigateToTrip(event, '${t.deviceId}', '${t.gStart.toISOString()}', '${t.gStop.toISOString()}')">Ver viaje</a></td></tr>`).join('')}
                    </tbody></table></div>` : `<div class="state"><p>No se detectaron viajes con ocupación sin coincidencia CSV.</p></div>`}
                    <div class="table-footer"><span>${frauds.length} casos para revisar</span></div>
                </div>
            `);
            document.getElementById('resultsArea').innerHTML = html.join('');
            const btnExport = document.getElementById('btnExport');
            if (btnExport) btnExport.style.display = hasCsv && frauds.length ? 'inline-flex' : 'none';
            const btnPdf = document.getElementById('btnExportPDF');
            if (btnPdf) btnPdf.style.display = 'inline-flex';
        },
        // ── GENERATE HEATMAP ─────────────────────────────────────
        generateHeatmap: function(trips, title) {
            const map = Array(7).fill(0).map(() => Array(24).fill(0));
            let maxCount = 0;
            
            trips.forEach(t => {
                const firstEvent = t._passengerAnalysis && t._passengerAnalysis.events && t._passengerAnalysis.events[0];
                const date = firstEvent ? new Date(firstEvent.eventStart) : t.gStart;
                let day = date.getDay() - 1;
                if (day === -1) day = 6;
                const hour = date.getHours();
                map[day][hour]++;
                if (map[day][hour] > maxCount) maxCount = map[day][hour];
            });

            const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
            let gridHtml = '';
            for (let d = 0; d < 7; d++) {
                for (let h = 0; h < 24; h++) {
                    const count = map[d][h];
                    const intensity = maxCount > 0 ? (count / maxCount) : 0;
                    let bg = 'var(--surface)';
                    if (count > 0) {
                        const alpha = 0.15 + (intensity * 0.85);
                        bg = `rgba(220, 38, 38, ${alpha})`;
                    }
                    const tooltip = `${days[d]} ${h.toString().padStart(2,'0')}:00 - ${count} casos: ${title.toLowerCase()}`;
                    gridHtml += `<div class="hm-cell" style="background:${bg};" title="${tooltip}"></div>`;
                }
            }

            let xLabels = '';
            for (let h = 0; h < 24; h+=2) {
                xLabels += `<div class="heatmap-x-label">${h}h</div>`;
            }

            return `
            <div class="heatmap-wrapper">
                <div class="heatmap-title">Mapa de calor: ${title}</div>
                <div class="heatmap-layout">
                    <div class="heatmap-y-labels">
                        ${days.map(d => `<span>${d}</span>`).join('')}
                    </div>
                    <div style="flex:1; display:flex; flex-direction:column;">
                        <div class="heatmap-grid">${gridHtml}</div>
                        <div class="heatmap-x-labels">${xLabels}</div>
                    </div>
                </div>
            </div>`;
        },

        // ── EXPORT EXCEL ─────────────────────────────────────────
        exportExcel: function() {
            const frauds = currentTrips.filter(t => t._passengerAnalysis && t._passengerAnalysis.hasPassenger && !t.matched);
            if (!frauds.length) return;
            const rows = [
                ['Matrícula', 'Fecha', 'Inicio Geotab', 'Fin Geotab', 'Eventos Passenger.Disallowed', 'Paradas rápidas', 'Estado CSV'],
                ...frauds.map(t => [t.plateOrig, fmtDate(t.gStart), fmtTime(t.gStart), fmtTime(t.gStop),
                    t._passengerAnalysis.events.length, t._stopAnalysis ? t._stopAnalysis.quickStops : 0, 'Sin coincidencia'])
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, 'Ocupación sin registro');
            XLSX.writeFile(wb, `ocupacion_sin_registro_${new Date().toISOString().slice(0,10)}.xlsx`);
        },
        // ── EXPORT PDF ───────────────────────────────────────────
        exportPDF: function(csvData) {
            if (typeof html2pdf === 'undefined') {
                console.error("La librería html2pdf.js no está cargada.");
                alert("Error al cargar la librería de exportación a PDF.");
                return;
            }

            // Añadir clase para modo impresión (ocultar botones, ajustes CSS)
            document.body.classList.add('pdf-mode');

            // CERRAR todos los desplegables de vehículos para que el PDF sea un reporte ejecutivo (evita cuelgues por DOM gigante)
            document.querySelectorAll('.expand-section').forEach(el => el.classList.remove('open'));

            const element = document.getElementById('vtc-app-wrapper');
            const today = new Date().toISOString().slice(0,10);
            
            const opt = {
                margin:       10,
                filename:     `auditoria_vtc_${today}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, logging: false },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().set(opt).from(element).save().then(() => {
                // Quitar clase de impresión
                document.body.classList.remove('pdf-mode');
            }).catch(err => {
                console.error("Error generando PDF", err);
                document.body.classList.remove('pdf-mode');
            });
        },

        // ── VEHICLE MODAL ────────────────────────────────────────
        showVehicleModal: function(plateOrig) {
            const vTrips = currentTrips.filter(t => t.plateOrig === plateOrig);
            if (vTrips.length === 0) return;

            const total = vTrips.length;
            const matched = vTrips.filter(t => t.matched).length;
            const unmatched = total - matched;
            const cov = total > 0 ? (matched / total) * 100 : 0;
            const totalScore = vTrips.reduce((acc, r) => acc + r.audit.score, 0);
            const avgRisk = total > 0 ? totalScore / total : 0;
            
            vTrips.sort((a,b) => b.audit.score - a.audit.score);

            let tripListHtml = '';
            vTrips.forEach(t => {
                const adt = t.audit;
                const fromIso = t.gStart.toISOString();
                const toIso   = t.gStop.toISOString();

                let matchBadge = '';
                if (adt.fraudAlert) {
                    matchBadge = `<span class="pill" style="background:var(--danger);color:white;font-weight:bold;">🚨 ${adt.fraudAlert}</span>`;
                } else {
                    matchBadge = t.matched
                        ? `<span class="pill pill-ok">APP (${t.csvCount})</span>`
                        : `<span class="pill pill-danger">Sin APP</span>`;
                }

                const stopSummary = t._stopAnalysis.quickStops > 0
                    ? `<span style="color:var(--warn);font-size:11px;">⚠️ ${t._stopAnalysis.quickStops} paradas</span>`
                    : '';

                const riskColors = { critico: '#dc2626', alto: '#d97706', medio: '#ca8a04', bajo: '#16a34a', normal: '#6b7280' };
                const riskBg = riskColors[adt.levelClass] || '#6b7280';
                const reasonsHtml = adt.reasons.map(r => `<li>${r}</li>`).join('');

                tripListHtml += `
                <div class="trip-item" style="margin-bottom:10px; display:block;">
                    <div style="display:flex; width:100%; justify-content:space-between; align-items:flex-start; gap:12px;">
                        <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                                <span style="padding:3px 8px; border-radius:4px; color:white; background:${riskBg}; font-weight:bold; font-size:11px;">
                                    ${adt.level} · ${adt.score} pts
                                </span>
                                <span class="trip-date">${fmtDate(t.gStart)}</span>
                                <span class="trip-time">${fmtTime(t.gStart)} – ${fmtTime(t.gStop)}</span>
                                <span class="trip-dist"><strong>${t.gDist} km</strong></span>
                                ${matchBadge}
                                ${stopSummary}
                            </div>
                            <div style="font-size:11px; color:var(--ink-mid);">
                                <ul style="margin:2px 0 0 14px; padding:0;">${reasonsHtml}</ul>
                            </div>
                        </div>
                        <a class="trip-link" href="#" style="white-space:nowrap; margin-top:4px;"
                           onclick="navigateToTrip(event, '${t.deviceId}', '${fromIso}', '${toIso}')">Ver Mapa</a>
                    </div>
                </div>`;
            });

            const html = `
            <div class="modal-overlay" id="vModalOverlay" onclick="if(event.target===this) document.getElementById('modalContainer').style.display='none';">
                <div class="modal-box">
                    <div class="modal-header">
                        <div class="modal-title">
                            <svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:var(--accent);fill:none;stroke-width:2;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="10" cy="13" r="2"/><line x1="11.4" y1="14.4" x2="15" y2="18"/></svg>
                            Ficha de Vehículo: ${plateOrig}
                        </div>
                        <button class="modal-close" onclick="document.getElementById('modalContainer').style.display='none';">
                            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="modal-grid">
                            <div class="modal-sidebar">
                                <div class="metric">
                                    <div class="metric-label">Riesgo Medio</div>
                                    <div class="metric-value">${avgRisk.toFixed(1)} pts</div>
                                </div>
                                <div class="metric">
                                    <div class="metric-label">Cobertura APP</div>
                                    <div class="metric-value" style="color:${cov>=85?'var(--ok)':cov>=60?'var(--warn)':'var(--danger)'}">${cov.toFixed(1)}%</div>
                                    <div class="metric-sub">${matched} registrados / ${unmatched} sin APP</div>
                                </div>
                                <div style="background:white; border:1px solid var(--border); border-radius:var(--radius); padding:10px;">
                                    <canvas id="modalChart" height="200"></canvas>
                                </div>
                            </div>
                            <div class="modal-content-area">
                                <h3 style="font-size:14px; margin-bottom:12px;">Historial de Viajes (${total})</h3>
                                <div class="trip-list-container" style="max-height: 50vh; overflow-y:auto; padding-right:10px;">
                                    ${tripListHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

            const container = document.getElementById('modalContainer');
            container.innerHTML = html;
            container.style.display = 'block';
            
            // Trigger animation
            setTimeout(() => {
                document.getElementById('vModalOverlay').classList.add('show');
            }, 10);

            // Init chart
            const ctx = document.getElementById('modalChart');
            if (ctx && typeof Chart !== 'undefined') {
                new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Registrados', 'Sin APP'],
                        datasets: [{ data: [matched, unmatched], backgroundColor: ['#16a34a', '#dc2626'], borderWidth:0 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom' } } }
                });
            }
        }
    };

    // ── CHARTS JS INIT ───────────────────────────────────────
    function initCharts(matched, unmatched, vehicles) {
        if (_chartInstances && _chartInstances.length > 0) {
            _chartInstances.forEach(c => c.destroy());
            _chartInstances = [];
        }

        if (typeof Chart === 'undefined') {
            console.warn("Chart.js no está disponible.");
            return;
        }

        // 1. Chart Coverage (Donut)
        const ctxCov = document.getElementById('chartCoverage');
        if (ctxCov) {
            const chartCov = new Chart(ctxCov, {
                type: 'doughnut',
                data: {
                    labels: ['Registrados', 'No Registrados'],
                    datasets: [{
                        data: [matched, unmatched],
                        backgroundColor: ['#16a34a', '#dc2626'],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }
                    },
                    cutout: '70%'
                }
            });
            _chartInstances.push(chartCov);
        }

        // 2. Chart Risk (Bar)
        const top5 = vehicles.slice(0, 5);
        const ctxRisk = document.getElementById('chartRisk');
        if (ctxRisk && top5.length > 0) {
            const chartRisk = new Chart(ctxRisk, {
                type: 'bar',
                data: {
                    labels: top5.map(v => v.plateOrig),
                    datasets: [{
                        label: 'Riesgo Medio (pts)',
                        data: top5.map(v => v.avgRisk.toFixed(1)),
                        backgroundColor: top5.map(v => {
                            if (v.avgRisk > 60) return '#dc2626';
                            if (v.avgRisk > 40) return '#d97706';
                            if (v.avgRisk > 20) return '#ca8a04';
                            return '#16a34a';
                        }),
                        borderRadius: 4,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#f3f4f6' }, border: { display: false } },
                        x: { grid: { display: false }, border: { display: false } }
                    }
                }
            });
            _chartInstances.push(chartRisk);
        }
    }
})();
