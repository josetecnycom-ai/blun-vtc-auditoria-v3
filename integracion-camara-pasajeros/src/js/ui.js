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
        renderResults: function(trips, csvData, tolerance, minDist, targetDevices) {
            currentTrips = trips;
            if (targetDevices) _targetDevices = targetDevices;

            const filterPl = document.getElementById('filterVehicle').value;
            const showFilter = document.getElementById('filterShow').value;

            let data = trips;
            if (filterPl !== 'all') data = data.filter(r => r.plate === filterPl);

            // Métricas
            const totalGeotab = data.length;
            const totalMatched = data.filter(r => r.matched).length;
            const totalUnmatched = totalGeotab - totalMatched;
            const suspects = data.filter(r => r.audit.level === 'ALTO' || r.audit.level === 'CRÍTICO').length;
            const totalStopTimeSecs = data.reduce((acc, r) => acc + (r._stopAnalysis ? r._stopAnalysis.totalStopTime : 0), 0);
            const totalQuickStops = data.reduce((acc, r) => acc + (r._stopAnalysis ? r._stopAnalysis.quickStops : 0), 0);
            const passengerFrauds = data.filter(r => r._passengerAnalysis && r._passengerAnalysis.hasPassenger && !r.matched).length;
            const avgRiskScore = totalGeotab > 0 ? (data.reduce((acc, r) => acc + r.audit.score, 0) / totalGeotab) : 0;

            const coveragePct = totalGeotab > 0 ? ((totalMatched / totalGeotab) * 100).toFixed(1) : 0;

            // Agrupar por vehículo
            const byPlate = {};
            data.forEach(r => {
                if (!byPlate[r.plate]) {
                    byPlate[r.plate] = {
                        plate: r.plate, plateOrig: r.plateOrig,
                        deviceName: r.deviceName, deviceId: r.deviceId,
                        total: 0, matched: 0, unmatched: 0,
                        avgRisk: 0, _totalRisk: 0,
                        trips: []
                    };
                }
                byPlate[r.plate].total++;
                if (r.matched) byPlate[r.plate].matched++;
                else byPlate[r.plate].unmatched++;
                byPlate[r.plate]._totalRisk += r.audit.score;
                byPlate[r.plate].trips.push(r);
            });

            let vehicles = Object.values(byPlate);
            vehicles.forEach(v => { v.avgRisk = v._totalRisk / v.total; });
            vehicles.sort((a,b) => b.avgRisk - a.avgRisk);

            const html = [];

            // ── DASHBOARD ──
            html.push(`
            <div class="info-bar">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Período: ${fmtDateShort(new Date(csvData.minDate))} – ${fmtDateShort(new Date(csvData.maxDate))} ·
                Tolerancia ±${tolerance} min · Distancia mínima ≥ ${minDist} km ·
                ${vehicles.length} vehículos analizados
            </div>

            <div class="metrics" style="grid-template-columns: repeat(auto-fit,minmax(140px,1fr));">
                <div class="metric m-accent">
                    <div class="metric-label">Trips Geotab</div>
                    <div class="metric-value">${totalGeotab}</div>
                </div>
                <div class="metric m-ok">
                    <div class="metric-label">Registrados APP</div>
                    <div class="metric-value">${totalMatched}</div>
                    <div class="metric-sub">${coveragePct}% cobertura</div>
                </div>
                <div class="metric m-danger">
                    <div class="metric-label">No Registrados</div>
                    <div class="metric-value">${totalUnmatched}</div>
                </div>
                <div class="metric" style="border-color:var(--warn);">
                    <div class="metric-label">🚨 Sospechosos</div>
                    <div class="metric-value">${suspects}</div>
                </div>
                <div class="metric m-danger">
                    <div class="metric-label">🎥 Ocupación sin APP</div>
                    <div class="metric-value">${passengerFrauds}</div>
                    <div class="metric-sub">Fraude probable</div>
                </div>                <div class="metric">
                    <div class="metric-label">Tiempo Detenido</div>
                    <div class="metric-value" style="font-size:20px;">${fmtDur(totalStopTimeSecs)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Paradas Rápidas</div>
                    <div class="metric-value" style="font-size:22px;">${totalQuickStops}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Riesgo Medio</div>
                    <div class="metric-value" style="font-size:22px;">${avgRiskScore.toFixed(0)} pts</div>
                </div>
            </div>
            `);

            // ── HEATMAP ──
            const hmTrips = data.filter(r => !r.matched);
            html.push(UI.generateHeatmap(hmTrips));

            // ── CHARTS ──
            html.push(`
            <div class="charts-container" style="display:flex; gap:20px; margin: 20px 0; flex-wrap:wrap;">
                <div class="chart-card" style="flex: 1; min-width: 300px; background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--border);">
                    <h3 style="margin-top:0; margin-bottom:15px; font-size:14px; color:var(--ink);">Cobertura APP vs Geotab</h3>
                    <div style="position:relative; height:220px; width:100%;">
                        <canvas id="chartCoverage"></canvas>
                    </div>
                </div>
                <div class="chart-card" style="flex: 2; min-width: 400px; background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--border);">
                    <h3 style="margin-top:0; margin-bottom:15px; font-size:14px; color:var(--ink);">Top 5 Vehículos con Mayor Riesgo</h3>
                    <div style="position:relative; height:220px; width:100%;">
                        <canvas id="chartRisk"></canvas>
                    </div>
                </div>
            </div>
            `);

            // ── TABLA DE VEHÍCULOS ──
            html.push(`
            <div class="table-card">
                <div class="table-toolbar">
                    <span class="table-title">Análisis de Flota</span>
                    <div class="table-controls">
                        <input class="search" id="searchInput" placeholder="Buscar matrícula…" onkeyup="
                            const q = this.value.toLowerCase();
                            document.querySelectorAll('.vehicle-row').forEach(row => {
                                const text = row.textContent.toLowerCase();
                                row.style.display = text.includes(q) ? '' : 'none';
                                const next = row.nextElementSibling;
                                if (next) next.style.display = text.includes(q) ? '' : 'none';
                            });
                        "/>
                    </div>
                </div>
                <div class="table-wrap">
                <table>
                <thead><tr>
                    <th>Vehículo</th>
                    <th>Trips Geotab</th>
                    <th>Cobertura APP</th>
                    <th>Paradas</th>
                    <th>Riesgo Medio</th>
                    <th></th>
                </tr></thead>
                <tbody>
            `);

            vehicles.forEach((v, vi) => {
                const cov = v.total > 0 ? (v.matched/v.total*100) : 0;
                const totalVStops = v.trips.reduce((acc, t) => acc + (t._stopAnalysis ? t._stopAnalysis.quickStops : 0), 0);

                let vRiskClass = 'normal';
                if (v.avgRisk > 60)      vRiskClass = 'critico';
                else if (v.avgRisk > 40) vRiskClass = 'alto';
                else if (v.avgRisk > 20) vRiskClass = 'medio';
                else if (v.avgRisk > 10) vRiskClass = 'bajo';

                const barColor = cov >= 85 ? 'var(--ok)' : cov >= 60 ? 'var(--warn)' : 'var(--danger)';

                let detailTrips = v.trips.slice();
                if (showFilter === 'unmatched') detailTrips = detailTrips.filter(t => !t.matched);
                detailTrips.sort((a,b) => b.audit.score - a.audit.score);

                html.push(`
                <tr class="vehicle-row" onclick="UI.showVehicleModal('${v.plateOrig}')">
                    <td><strong>${v.plateOrig}</strong> <small style="color:var(--ink-mid);">${v.deviceName}</small></td>
                    <td>${v.total} <small style="color:var(--danger)">(${v.unmatched} sin APP)</small></td>
                    <td>
                        <div class="mini-bar">
                            <div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${cov.toFixed(0)}%;background:${barColor};"></div></div>
                            <span style="font-size:10px;">${cov.toFixed(0)}%</span>
                        </div>
                    </td>
                    <td>${totalVStops}</td>
                    <td><span class="pill pill-${vRiskClass}">${v.avgRisk.toFixed(0)} pts</span></td>
                    <td style="color:var(--ink-light);font-size:12px;">🔍 Ficha Completa</td>
                </tr>
                `);
            });

            html.push(`</tbody></table></div>`);
            html.push(`<div class="table-footer"><span>${vehicles.length} vehículos · ${data.length} trips analizados</span></div>`);
            html.push(`</div>`);

            document.getElementById('resultsArea').innerHTML = html.join('');
            document.getElementById('btnExport').style.display = 'inline-flex';
            const btnPdf = document.getElementById('btnExportPDF');
            if (btnPdf) btnPdf.style.display = 'inline-flex';
            
            // Iniciar gráficos
            initCharts(totalMatched, totalUnmatched, vehicles);
        },

        // ── GENERATE HEATMAP ─────────────────────────────────────
        generateHeatmap: function(trips) {
            const map = Array(7).fill(0).map(() => Array(24).fill(0));
            let maxCount = 0;
            
            trips.forEach(t => {
                const date = t.gStart;
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
                    const tooltip = `${days[d]} ${h.toString().padStart(2,'0')}:00 - ${count} viajes sin APP`;
                    gridHtml += `<div class="hm-cell" style="background:${bg};" title="${tooltip}"></div>`;
                }
            }

            let xLabels = '';
            for (let h = 0; h < 24; h+=2) {
                xLabels += `<div class="heatmap-x-label">${h}h</div>`;
            }

            return `
            <div class="heatmap-wrapper">
                <div class="heatmap-title">Mapa de Calor: Frecuencia de Viajes "Sin APP"</div>
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
        exportExcel: function(csvData) {
            if (!currentTrips || currentTrips.length === 0) return;
            const suspects = currentTrips.filter(r => r.audit.level === 'ALTO' || r.audit.level === 'CRÍTICO');

            const rows = [
                ['Matrícula', 'Conductor Geotab', 'Fecha', 'Hora inicio', 'Hora fin', 'Duración (min)', 'Distancia (km)', 'Estado APP / Alertas', 'Puntuación Riesgo', 'Nivel Riesgo', 'Paradas Rápidas', 'Tiempo Total Paradas', 'Motivos'],
                ...suspects.map(r => [
                    r.plateOrig, r.geotabDriverName,
                    fmtDate(r.gStart), fmtTime(r.gStart), fmtTime(r.gStop),
                    r.gDur, r.gDist,
                    r.audit.fraudAlert ? r.audit.fraudAlert : (r.matched ? 'Sí' : 'No'),
                    r.audit.score, r.audit.level,
                    r._stopAnalysis.quickStops,
                    fmtDur(r._stopAnalysis.totalStopTime),
                    r.audit.reasons.join(' | ')
                ])
            ];

            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.aoa_to_sheet(rows);
            ws1['!cols'] = [12, 25, 12, 10, 10, 12, 12, 12, 12, 10, 12, 18, 80].map(w => ({wch: w}));
            XLSX.utils.book_append_sheet(wb, ws1, 'Viajes Sospechosos');

            const today = new Date().toISOString().slice(0,10);
            XLSX.writeFile(wb, `auditoria_vtc_${today}.xlsx`);
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
