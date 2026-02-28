document.addEventListener("DOMContentLoaded", function () {

    fetch("data.json")
        .then(r => r.json())
        .then(data => render(data))
        .catch(err => {
            console.error("Failed to load data:", err);
            document.getElementById("last-updated").textContent = "Failed to load forecast data";
        });

    function render(data) {
        // Year in title
        const year = data.year || new Date().getFullYear();
        document.getElementById("siteTitle").textContent = year + " Lake Sammamish Seasonal Outlook";
        document.title = year + " Lake Sammamish Seasonal Outlook";

        // Timestamp
        const el = document.getElementById("last-updated");
        if (data.generated_at) {
            const ts = new Date(data.generated_at);
            const now = new Date();
            const isToday = ts.toDateString() === now.toDateString();
            const timeStr = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(ts);
            el.textContent = isToday ? "Updated today, " + timeStr : "Updated " +
                new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ts) + ", " + timeStr;
        }

        // Bias info
        const info = document.getElementById("infoStrip");
        if (data.bias_f != null) {
            const dir = data.bias_f > 0 ? "warmer" : "colder";
            const abs = Math.abs(data.bias_f).toFixed(1);
            if (Math.abs(data.bias_f) > 0.5) {
                info.textContent = `Water is trending ${abs}\u00B0F ${dir} than average this year`;
            }
        }

        // Find where score first hits 60 ("Good") and 80 ("Excellent")
        const subtitle = document.getElementById("subtitle");
        const goodDay = data.forecast.find(d => d.smoothed_score >= 60);
        const excellentDay = data.forecast.find(d => d.smoothed_score >= 80);
        if (goodDay) {
            const gd = new Date(goodDay.date + "T12:00:00");
            const gdStr = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(gd);
            let text = `Conditions projected "Good" by ${gdStr}`;
            if (excellentDay) {
                const ed = new Date(excellentDay.date + "T12:00:00");
                const edStr = new Intl.DateTimeFormat("en-US", { month: "long" }).format(ed);
                text += `, "Excellent" by ${edStr}`;
            }
            subtitle.textContent = text;
        }

        // Metric definitions
        const metrics = {
            comfort: {
                field: "smoothed_score",
                label: "Comfort Score",
                unit: "",
                color: "#2980b9",
                yMin: 0,
                yMax: 100,
                stepSize: 20,
                tickLabels: { 0: "Unsafe", 20: "Poor", 40: "Fair", 60: "Good", 80: "Excellent", 100: "" },
                tierBands: true,
                hasHistorical: true,
                tooltipSuffix: "",
            },
            water_temp: {
                field: "water_temp_f",
                label: "Water Temperature",
                unit: "\u00B0F",
                color: "#e67e22",
                yMin: 35,
                yMax: 85,
                stepSize: 10,
                tickLabels: null,
                tierBands: false,
                hasHistorical: false,
                tooltipSuffix: "\u00B0F",
            },
            air_temp: {
                field: "air_temp_f",
                label: "Air Temperature",
                unit: "\u00B0F",
                color: "#e74c3c",
                yMin: 30,
                yMax: 100,
                stepSize: 10,
                tickLabels: null,
                tierBands: false,
                hasHistorical: false,
                tooltipSuffix: "\u00B0F",
            },
            solar: {
                field: "solar_w",
                label: "Solar Radiation",
                unit: " W/m\u00B2",
                color: "#f1c40f",
                yMin: 0,
                yMax: 800,
                stepSize: 200,
                tickLabels: null,
                tierBands: false,
                hasHistorical: false,
                tooltipSuffix: " W/m\u00B2",
            },
            rain: {
                field: "rain_pct",
                label: "Rain Chance",
                unit: "%",
                color: "#3498db",
                yMin: 0,
                yMax: 100,
                stepSize: 25,
                tickLabels: null,
                tierBands: false,
                hasHistorical: false,
                tooltipSuffix: "%",
            },
        };

        // Comfort tier background bands
        function tierBandsPlugin() {
            return {
                id: "tierBands",
                beforeDraw: (chart) => {
                    if (!chart.config._tierBands) return;
                    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
                    if (!y) return;
                    ctx.save();
                    const bands = [
                        { min: 80, max: 100, color: "rgba(39,174,96,0.06)" },
                        { min: 60, max: 80, color: "rgba(241,196,15,0.06)" },
                        { min: 40, max: 60, color: "rgba(230,126,34,0.06)" },
                        { min: 20, max: 40, color: "rgba(231,76,60,0.06)" },
                        { min: 0, max: 20, color: "rgba(142,68,173,0.06)" },
                    ];
                    for (const b of bands) {
                        const y1 = y.getPixelForValue(b.max);
                        const y2 = y.getPixelForValue(b.min);
                        ctx.fillStyle = b.color;
                        ctx.fillRect(left, Math.max(y1, top), right - left, Math.min(y2, bottom) - Math.max(y1, top));
                    }
                    ctx.restore();
                }
            };
        }

        // "Today" vertical line
        function todayLinePlugin() {
            return {
                id: "todayLine",
                afterDraw: (chart) => {
                    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                    if (!x) return;
                    const now = new Date();
                    now.setHours(12, 0, 0, 0);
                    const xPos = x.getPixelForValue(now.getTime());
                    if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) return;
                    ctx.save();
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = "rgba(0,0,0,0.15)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(xPos, top);
                    ctx.lineTo(xPos, bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = "rgba(0,0,0,0.35)";
                    ctx.font = "11px sans-serif";
                    ctx.fillText("Today", xPos + 4, top + 13);
                    ctx.restore();
                }
            };
        }

        // Detail panel
        const detailPanel = document.getElementById("detailPanel");
        const detailClose = document.getElementById("detailClose");
        detailClose.addEventListener("click", () => detailPanel.classList.remove("open"));

        function showDetail(dayData) {
            detailPanel.classList.add("open");

            const dt = new Date(dayData.date + "T12:00:00");
            document.getElementById("detailDate").textContent =
                new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(dt);

            document.getElementById("detailBadge").textContent = Math.round(dayData.smoothed_score);
            document.getElementById("detailLabel").textContent = dayData.label;

            const components = [
                { key: "water_temp", label: "Water temp", weight: 30 },
                { key: "air_temp", label: "Air temp", weight: 20 },
                { key: "wind", label: "Wind", weight: 15 },
                { key: "sun", label: "Sunshine", weight: 10 },
                { key: "rain", label: "Rain", weight: 10 },
            ];

            function barColor(score) {
                if (score >= 70) return "#27ae60";
                if (score >= 40) return "#e6a817";
                return "#e74c3c";
            }

            const barsEl = document.getElementById("detailBars");
            barsEl.innerHTML = "";
            const scores = dayData.component_scores || {};
            for (const c of components) {
                const score = scores[c.key] != null ? scores[c.key] : 50;
                const row = document.createElement("div");
                row.className = "detail-bar-row";
                row.innerHTML = `
                    <span class="detail-bar-label">${c.label}</span>
                    <div class="detail-bar-track">
                        <div class="detail-bar-fill" style="width:${score}%;background:${barColor(score)}"></div>
                    </div>
                    <span class="detail-bar-value">${Math.round(score)}</span>
                `;
                barsEl.appendChild(row);
            }

            const condEl = document.getElementById("detailConditions");
            const conditions = [
                { label: "Water", value: dayData.water_temp_f != null ? dayData.water_temp_f + "\u00B0F" : "\u2014" },
                { label: "Air", value: dayData.air_temp_f != null ? dayData.air_temp_f + "\u00B0F" : "\u2014" },
                { label: "Wind", value: dayData.wind_mph != null ? dayData.wind_mph + " mph" : "\u2014" },
                { label: "Sun", value: dayData.solar_w != null ? Math.round(dayData.solar_w) + " W/m\u00B2" : "\u2014" },
                { label: "Rain", value: dayData.rain_pct != null ? Math.round(dayData.rain_pct) + "%" : "\u2014" },
            ];
            condEl.innerHTML = conditions.map(c =>
                `<span class="detail-condition"><span class="detail-condition-label">${c.label}</span> <span class="detail-condition-value">${c.value}</span></span>`
            ).join("");

            detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }

        // Build chart for a given metric
        const canvas = document.getElementById("forecastChart");
        canvas.style.cursor = "pointer";
        let chart = null;

        function buildChart(metricKey) {
            if (chart) chart.destroy();

            const m = metrics[metricKey];

            const projected = data.forecast.map(d => ({
                x: new Date(d.date + "T12:00:00"),
                y: d[m.field]
            }));

            const datasets = [
                {
                    label: m.label + " (Projected)",
                    data: projected,
                    borderColor: m.color,
                    backgroundColor: m.color + "22",
                    fill: true,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.4
                }
            ];

            if (m.hasHistorical && data.historical_avg) {
                const historical = data.historical_avg.map(d => ({
                    x: new Date(d.date + "T12:00:00"),
                    y: d.score
                }));
                datasets.push({
                    label: "Historical Average",
                    data: historical,
                    borderColor: "#bbb",
                    backgroundColor: "transparent",
                    fill: false,
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    tension: 0.4
                });
            }

            const yTickCallback = m.tickLabels
                ? function (value) { return m.tickLabels[value] || ""; }
                : function (value) { return value + m.unit; };

            chart = new Chart(canvas, {
                type: "line",
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    onClick: (evt, elements) => {
                        if (!elements.length) return;
                        const idx = elements[0].index;
                        const di = elements[0].datasetIndex;
                        if (di !== 0) return;
                        const day = data.forecast[idx];
                        if (day) showDetail(day);
                    },
                    scales: {
                        x: {
                            type: "time",
                            min: new Date(year, 2, 1, 12).getTime(),  // March 1
                            max: new Date(year, 9, 31, 12).getTime(), // October 31
                            time: {
                                unit: "month",
                                tooltipFormat: "MMM d",
                                displayFormats: { month: "MMM" }
                            },
                            ticks: { font: { size: 13 } },
                            grid: { color: "rgba(0,0,0,0.05)" }
                        },
                        y: {
                            min: m.yMin,
                            max: m.yMax,
                            ticks: {
                                font: { size: 12 },
                                stepSize: m.stepSize,
                                callback: yTickCallback
                            },
                            grid: { color: "rgba(0,0,0,0.05)" }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    if (!items.length) return "";
                                    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date(items[0].raw.x));
                                },
                                label: (ti) => {
                                    const val = ti.raw.y != null ? Math.round(ti.raw.y) : "\u2014";
                                    if (ti.datasetIndex === 0) return m.label + ": " + val + m.tooltipSuffix;
                                    return "Historical: " + val;
                                }
                            }
                        }
                    }
                },
                plugins: [tierBandsPlugin(), todayLinePlugin()]
            });
            chart.config._tierBands = m.tierBands;
        }

        // Legend visibility
        const legendStrip = document.getElementById("legendStrip");

        function setMetric(metricKey) {
            document.querySelectorAll(".metric-pill").forEach(p => p.classList.remove("active"));
            document.querySelector(`.metric-pill[data-metric="${metricKey}"]`).classList.add("active");
            buildChart(metricKey);
            legendStrip.style.display = metrics[metricKey].hasHistorical ? "" : "none";
        }

        // Pill click handlers
        document.querySelectorAll(".metric-pill").forEach(pill => {
            pill.addEventListener("click", () => setMetric(pill.dataset.metric));
        });

        // Initial render
        setMetric("comfort");
    }
});
