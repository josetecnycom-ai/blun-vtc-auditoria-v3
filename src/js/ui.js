// ui.js
// Maneja todo el renderizado visual y eventos DOM

const UI = (function() {

    let currentTrips = []; // Cache for exporting/sorting

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
        if (!s) return '0m';
        const m = Math.floor(s / 60);
        return m > 0 ? `${m}m` : `${Math.round(s)}s`;
    }

    // ── ENLACE AL MAPA ──────────────────────────────────────────────
    function buildMapUrl(t) {
        const from = encodeURIComponent(t.gStart.toISOString());
        const to   = encodeURIComponent(t.gStop.toISOString());
        return `https://my.geotab.com/blun/#tripsHistory,${t.deviceId},${from},${to}`;
    }

    // ── DOM UTILS ───────────────────────────────────────────────────
    function showLoading(msg) {
        document.getElementById('resultsArea').innerHTML =
            `<div class="state"><div class="spinner"></div><p class="progress-msg">${msg}</p></div>`;
        document.getElementById('btnExport').style.display = 'none';
    }
    function updateLoading(msg) {
        const p = document.querySelector('.progress-msg');
        if (p) p.textContent = msg;
    }
    function showError(msg) {
        document.getElementById('resultsArea').innerHTML =
            `<div class="state"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>${msg}</p></div>`;
    }

    return {
        showLoading, updateLoading, showError,

        // ── RENDER PRINCIPAL ─────────────────────────────────────
        renderResults: function(trips, csvData, tolerance, minDist) {
            currentTrips = trips;
            const filterPl = document.getElementById('filterVehicle').value;
            const showFilter = document.getElementById('filterShow').value;

            let data = trips;
            if (filterPl !== 'all') data = data.filter(r => r.plate === filterPl);

            // Métricas
            const totalGeotab = data.length;
            const totalMatched = data.filter(r => r.matched).length;
            const totalUnmatched = totalGeotab - totalMatched;
            
            // Nuevas métricas V3
            const suspects = data.filter(r => r.audit.level === 'ALTO' || r.audit.level === 'CRÍTICO').length;
            const totalStopTimeSecs = data.reduce((acc, r) => acc + (r._stopAnalysis ? r._stopAnalysis.totalStopTime : 0), 0);
            const totalQuickStops = data.reduce((acc, r) => acc + (r._stopAnalysis ? r._stopAnalysis.quickStops : 0), 0);
            const avgRiskScore = totalGeotab > 0 ? (data.reduce((acc, r) => acc + r.audit.score, 0) / totalGeotab) : 0;

            const coveragePct = totalGeotab > 0 ? ((totalMatched / totalGeotab) * 100).toFixed(1) : 0;
            const coverageClass = coveragePct >= 85 ? 'm-ok' : coveragePct >= 60 ? 'm-warn' : 'm-danger';

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
            // Calculamos media de riesgo por vehículo
            vehicles.forEach(v => { v.avgRisk = v._totalRisk / v.total; });
            
            // Por defecto en V3 ordenamos los vehículos por su media de riesgo (de peor a mejor)
            vehicles.sort((a,b) => b.avgRisk - a.avgRisk);

            const html = [];

            // ── NUEVO DASHBOARD V3 ──
            html.push(`
            <div class="info-bar">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Período: ${fmtDateShort(new Date(csvData.minDate))} – ${fmtDateShort(new Date(csvData.maxDate))} ·
                Tolerancia ±${tolerance} min · Distancia mínima ≥ ${minDist} km ·
                ${csvData.platesCount} vehículos en CSV · ${vehicles.length} vehículos en Geotab
            </div>
            
            <div class="metrics" style="grid-template-columns: repeat(auto-fit,minmax(140px,1fr));">
                <div class="metric m-accent">
                    <div class="metric-label">Trips Geotab</div>
                    <div class="metric-value">${totalGeotab}</div>
                </div>
                <div class="metric m-ok">
                    <div class="metric-label">Registrados</div>
                    <div class="metric-value">${totalMatched}</div>
                </div>
                <div class="metric m-danger">
                    <div class="metric-label">No Registrados</div>
                    <div class="metric-value">${totalUnmatched}</div>
                </div>
                <div class="metric m-warn" style="border-color:var(--warn);">
                    <div class="metric-label">🚨 Sospechosos</div>
                    <div class="metric-value">${suspects}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Tiempo Detenido</div>
                    <div class="metric-value" style="font-size:22px;">${fmtDur(totalStopTimeSecs)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Paradas Rápidas</div>
                    <div class="metric-value" style="font-size:22px;">${totalQuickStops}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Riesgo Medio</div>
                    <div class="metric-value" style="font-size:22px;">${avgRiskScore.toFixed(0)}%</div>
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
                    <th>Trips</th>
                    <th>Cobertura</th>
                    <th>Paradas Totales</th>
                    <th>Riesgo Medio</th>
                    <th></th>
                </tr></thead>
                <tbody>
            `);

            vehicles.forEach((v, vi) => {
                const cov = v.total > 0 ? (v.matched/v.total*100) : 0;
                const totalVStops = v.trips.reduce((acc, t) => acc + (t._stopAnalysis?t._stopAnalysis.quickStops:0), 0);
                
                const avgRiskLvl = RiskEngine.evaluateTrip({matched: true, distance: 0, _stopAnalysis:{quickStops:0, stopLocations:[]}}).level; // Fake call just to map score to level logic if needed, actually let's use a simpler logic for the vehicle:
                let vRiskClass = 'bajo';
                if(v.avgRisk > 60) vRiskClass = 'critico';
                else if(v.avgRisk > 40) vRiskClass = 'alto';
                else if(v.avgRisk > 20) vRiskClass = 'medio';

                const barColor = cov >= 85 ? 'var(--ok)' : cov >= 60 ? 'var(--warn)' : 'var(--danger)';

                let detailTrips = v.trips;
                if (showFilter === 'unmatched') detailTrips = v.trips.filter(t => !t.matched);
                detailTrips.sort((a,b) => b.audit.score - a.audit.score); // Ordenar por mayor riesgo primero

                html.push(`
                <tr class="vehicle-row" onclick="
                    const el = document.getElementById('exp-${vi}');
                    const isOpen = el.classList.contains('open');
                    document.querySelectorAll('.expand-section.open').forEach(e => e.classList.remove('open'));
                    if (!isOpen) el.classList.add('open');
                ">
                    <td><strong>${v.plateOrig}</strong> <small style="color:var(--ink-mid);">${v.deviceName}</small></td>
                    <td>${v.total} <small style="color:var(--danger)">(${v.unmatched} gaps)</small></td>
                    <td>
                        <div class="mini-bar" style="width: 100px;">
                            <div class="mini-bar-bg" style="width: 100%;"><div class="mini-bar-fill" style="width:${cov.toFixed(0)}%;background:${barColor};"></div></div>
                            <span style="font-size:10px;">${cov.toFixed(0)}%</span>
                        </div>
                    </td>
                    <td>${totalVStops}</td>
                    <td>
                        <span class="pill pill-${vRiskClass}">${v.avgRisk.toFixed(0)}% Riesgo</span>
                    </td>
                    <td style="color:var(--ink-light);font-size:12px;">▼ ver viajes</td>
                </tr>
                `);

                // ── DETALLE DEL VIAJE CON ÍNDICE DE CONFIANZA ──
                html.push(`<tr><td colspan="6" style="padding:0;">`);
                html.push(`<div class="expand-section" id="exp-${vi}">`);
                html.push(`<div class="trips-sub">`);
                
                if (detailTrips.length === 0) {
                    html.push(`<p style="font-size:12px;color:var(--ok);">✓ No hay viajes que mostrar con el filtro actual.</p>`);
                } else {
                    html.push(`<div class="trip-list">`);
                    detailTrips.forEach(t => {
                        const mapUrl = buildMapUrl(t);
                        const adt = t.audit;
                        
                        let reasonsHtml = adt.reasons.map(r => `<li>${r}</li>`).join('');

                        html.push(`
                        <div class="trip-item" style="display:flex; flex-direction:column; align-items:flex-start; padding: 14px; gap: 8px;">
                            <div style="display:flex; width: 100%; justify-content: space-between; align-items: center;">
                                <div style="display:flex; gap: 15px; align-items:center;">
                                    <span class="badge badge-${adt.levelClass}" style="padding:4px 8px; border-radius:4px; color:white; background:var(--riesgo-${adt.levelClass}); font-weight:bold; font-size:11px;">Riesgo ${adt.confidence}%</span>
                                    <span class="trip-date">${fmtDate(t.gStart)}</span>
                                    <span class="trip-time">${fmtTime(t.gStart)} – ${fmtTime(t.gStop)}</span>
                                    <span class="trip-dist">${t.gDist} km</span>
                                    <span class="trip-dur">${t.gDur} min</span>
                                    <span style="font-size:11px; color:var(--ink-mid);">Paradas: <strong>${t._stopAnalysis.quickStops}</strong> (${fmtDur(t._stopAnalysis.totalStopTime)})</span>
                                </div>
                                <a class="trip-link" href="${mapUrl}" target="_blank">Ver en Mapa</a>
                            </div>
                            <div style="background:var(--surface); padding:8px 12px; border-radius:4px; width:100%; font-size:11px; color:var(--ink-mid);">
                                <strong style="color:var(--ink);">Motivos del Nivel de Riesgo (${adt.level}):</strong>
                                <ul style="margin: 4px 0 0 16px; padding:0;">
                                    ${reasonsHtml}
                                </ul>
                            </div>
                        </div>`);
                    });
                    html.push(`</div>`);
                }
                html.push(`</div></div></td></tr>`);
            });

            html.push(`</tbody></table></div>`);
            html.push(`<div class="table-footer">
                <span>${vehicles.length} vehículos analizadost</span>
            </div>`);
            html.push(`</div>`);

            document.getElementById('resultsArea').innerHTML = html.join('');
            document.getElementById('btnExport').style.display = 'inline-flex';
        },

        // ── EXPORT EXCEL ─────────────────────────────────────────
        exportExcel: function(csvData) {
            if (!currentTrips || currentTrips.length === 0) return;
            const unmatched = currentTrips.filter(r => !r.matched);
            const suspects = currentTrips.filter(r => r.audit.level === 'ALTO' || r.audit.level === 'CRÍTICO');
            
            // Excel rows
            const rows = [
                ['Matrícula', 'Nombre Geotab', 'Conductor Geotab', 'Fecha', 'Hora inicio', 'Hora fin', 'Duración (min)', 'Distancia (km)', 'Riesgo %', 'Nivel', 'Paradas', 'Tiempo Paradas (s)', 'Enlace Mapa'],
                ...suspects.map(r => [
                    r.plateOrig, r.deviceName, r.geotabDriverName,
                    fmtDate(r.gStart), fmtTime(r.gStart), fmtTime(r.gStop),
                    r.gDur, r.gDist, r.audit.confidence, r.audit.level,
                    r._stopAnalysis.quickStops, r._stopAnalysis.totalStopTime,
                    buildMapUrl(r)
                ])
            ];

            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws1, 'Viajes Sospechosos');

            const today = new Date().toISOString().slice(0,10);
            XLSX.writeFile(wb, `auditoria_vtc_${today}.xlsx`);
        }
    };
})();
