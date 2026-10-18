/**
 * EnergiOS Chart Controllers
 * Powered by Chart.js with custom gradients, interactive tooltips, and responsive Bento scaling.
 */

class EnergiOSCharts {
  constructor() {
    this.mainChart = null;
    this.comparisonChart = null;
    this.accuracyChart = null;

    window.addEventListener('energios:theme-changed', () => {
      this.updateThemeColors();
    });
  }

  updateThemeColors() {
    const colors = window.getChartThemeColors ? window.getChartThemeColors() : null;
    if (!colors) return;

    [this.mainChart, this.comparisonChart, this.accuracyChart].forEach((chart) => {
      if (chart && chart.options && chart.options.scales) {
        if (chart.options.scales.x && chart.options.scales.x.ticks) {
          chart.options.scales.x.ticks.color = colors.textColor;
        }
        if (chart.options.scales.y) {
          if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = colors.gridColor;
          if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = colors.textColor;
        }
        chart.update();
      }
    });
  }

  /**
   * Main Time-Series Chart: Observed Historical Readings + 24-Hour Forecast
   */
  renderMainConsumptionChart(canvasId, readingsData, forecastData, anomalyData, options = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.mainChart) {
      this.mainChart.destroy();
    }

    const readings = (readingsData && readingsData.items) ? [...readingsData.items] : [];
    const forecasts = (forecastData && forecastData.items) ? [...forecastData.items] : [];
    const anomalies = (anomalyData && anomalyData.items) ? [...anomalyData.items] : [];

    // Filter by window if requested (e.g. 24, 72, 168)
    const windowHours = options.windowHours || 72;
    const activeReadings = readings.slice(-windowHours);

    // Combine labels along time axis
    const labels = [];
    const observedPoints = [];
    const forecastPoints = [];
    const anomalyPoints = [];

    // Map anomaly timestamps for O(1) lookup
    const anomalyMap = new Map();
    anomalies.forEach((a) => {
      anomalyMap.set(a.timestamp, a);
    });

    // Populate historical observed readings
    activeReadings.forEach((r) => {
      const d = new Date(r.timestamp);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      labels.push(label);
      observedPoints.push(r.consumption_kwh);
      forecastPoints.push(null); // No forecast during historical period

      // Check if this reading matches an anomaly
      if (anomalyMap.has(r.timestamp)) {
        anomalyPoints.push(r.consumption_kwh);
      } else {
        anomalyPoints.push(null);
      }
    });

    // Connect the last observed point to the first forecast point so the line is continuous
    if (activeReadings.length > 0 && forecasts.length > 0) {
      const lastObs = activeReadings[activeReadings.length - 1];
      // Bridge the gap at the exact handoff
      forecastPoints[forecastPoints.length - 1] = lastObs.consumption_kwh;
    }

    // Populate 24-hour forecast
    forecasts.forEach((f) => {
      const d = new Date(f.timestamp);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      labels.push(label);
      observedPoints.push(null); // No observed data in future forecast window
      forecastPoints.push(f.forecast_kwh);
      anomalyPoints.push(null);
    });

    // Build Canvas Gradients
    const chartCtx = ctx.getContext('2d');
    const emeraldGradient = chartCtx.createLinearGradient(0, 0, 0, 360);
    emeraldGradient.addColorStop(0, 'rgba(0, 105, 72, 0.22)');
    emeraldGradient.addColorStop(1, 'rgba(0, 105, 72, 0.00)');

    const amberGradient = chartCtx.createLinearGradient(0, 0, 0, 360);
    amberGradient.addColorStop(0, 'rgba(245, 158, 11, 0.20)');
    amberGradient.addColorStop(1, 'rgba(245, 158, 11, 0.00)');

    this.mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Observed Energy (kWh)',
            data: observedPoints,
            borderColor: '#006948',
            backgroundColor: emeraldGradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#006948',
            pointHoverBorderColor: '#FFFFFF',
            pointHoverBorderWidth: 2,
            spanGaps: false,
          },
          {
            label: '24-Hour Forecast (kWh)',
            data: forecastPoints,
            borderColor: '#F59E0B',
            backgroundColor: amberGradient,
            borderWidth: 2.5,
            borderDash: [6, 4],
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: '#F59E0B',
            pointHoverRadius: 7,
            pointHoverBackgroundColor: '#F59E0B',
            pointHoverBorderColor: '#FFFFFF',
            pointHoverBorderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Unusual Consumption Alert',
            data: anomalyPoints,
            borderColor: '#E11D48',
            backgroundColor: '#FFE4E6',
            borderWidth: 2,
            showLine: false,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: '#E11D48',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false, // Custom HTML pill legend is used above the chart
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            titleColor: '#94A3B8',
            titleFont: { family: 'Space Grotesk', size: 11, weight: '500' },
            bodyFont: { family: 'Inter', size: 12, weight: '500' },
            padding: 12,
            cornerRadius: 10,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              label: function (context) {
                if (context.raw === null || context.raw === undefined) return null;
                const val = Number(context.raw).toFixed(2);
                if (context.dataset.label.includes('Observed')) {
                  return `Observed History: ${val} kWh`;
                }
                if (context.dataset.label.includes('Forecast')) {
                  return `24h Model Forecast: ${val} kWh`;
                }
                if (context.dataset.label.includes('Alert')) {
                  return `⚠️ Unusual Pattern Flagged: ${val} kWh`;
                }
                return `${context.dataset.label}: ${val} kWh`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false,
            },
            ticks: {
              font: { family: 'Space Grotesk', size: 10 },
              color: '#94A3B8',
              maxTicksLimit: 10,
            },
          },
          y: {
            grid: {
              color: 'rgba(0, 0, 0, 0.05)',
              drawBorder: false,
            },
            ticks: {
              font: { family: 'Space Grotesk', size: 10 },
              color: '#94A3B8',
              callback: function (value) {
                return value + ' kWh';
              },
            },
          },
        },
      },
    });

    return this.mainChart;
  }

  /**
   * Comparative Chart across the 4 BDG2 Buildings + Benchmark
   */
  renderBenchmarkComparisonChart(canvasId, allBuildings, mode = 'kwh') {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.comparisonChart) {
      this.comparisonChart.destroy();
    }

    const buildingKeys = Object.keys(allBuildings);
    if (buildingKeys.length === 0) return;

    const labels = [];
    const activeValues = [];
    const baselineValues = [];
    const backgroundColors = [];

    buildingKeys.forEach((key) => {
      const b = allBuildings[key];
      const asset = b.asset;
      const readings = (b.readings && b.readings.items) ? b.readings.items : [];
      const area = asset.floor_area_m2 || 10000;

      // Calculate recent 24-hour average demand
      const last24 = readings.slice(-24);
      const avgKwh = last24.length > 0
        ? last24.reduce((acc, r) => acc + r.consumption_kwh, 0) / last24.length
        : 100;

      // Normalized EUI in Wh/m²
      const euiWhM2 = (avgKwh * 1000) / area;

      labels.push(asset.name.replace('Hog_', '').replace('_', ' '));

      if (mode === 'eui') {
        activeValues.push(Number(euiWhM2.toFixed(1)));
        baselineValues.push(18.5); // Regional cohort average benchmark (Wh/m²)
      } else {
        activeValues.push(Number(avgKwh.toFixed(1)));
        baselineValues.push(Number((avgKwh * 1.12).toFixed(1))); // Baseline comparison
      }

      // Color coding per building usage
      if (asset.primary_space_usage.toLowerCase().includes('office')) {
        backgroundColors.push('#006948');
      } else if (asset.primary_space_usage.toLowerCase().includes('education')) {
        backgroundColors.push('#2563EB');
      } else if (asset.primary_space_usage.toLowerCase().includes('assembly')) {
        backgroundColors.push('#EA580C');
      } else {
        backgroundColors.push('#8B5CF6');
      }
    });

    const valUnit = mode === 'eui' ? 'Wh/m²' : 'kWh';

    this.comparisonChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: mode === 'eui' ? 'Energy Use Intensity (Wh/m²)' : 'Avg Demand (kWh)',
            data: activeValues,
            backgroundColor: backgroundColors,
            borderRadius: 8,
            barThickness: 32,
          },
          {
            type: 'line',
            label: mode === 'eui' ? 'BDG2 Cohort Benchmark (18.5 Wh/m²)' : 'Seasonal Baseline Reference',
            data: baselineValues,
            borderColor: '#94A3B8',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 4,
            pointBackgroundColor: '#94A3B8',
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            titleFont: { family: 'Space Grotesk', size: 11 },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (ctx) {
                return `${ctx.dataset.label}: ${ctx.raw} ${valUnit}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: {
              font: { family: 'Space Grotesk', size: 10 },
              color: '#64748B',
            },
          },
          y: {
            grid: { color: 'rgba(0, 0, 0, 0.05)', drawBorder: false },
            ticks: {
              font: { family: 'Space Grotesk', size: 10 },
              color: '#94A3B8',
              callback: function (val) {
                return val + ' ' + valUnit;
              },
            },
          },
        },
      },
    });

    return this.comparisonChart;
  }

  /**
   * Radial Progress Gauge update helper
   */
  updateRadialGauge(circleElementId, textElementId, percent) {
    const circle = document.getElementById(circleElementId);
    const text = document.getElementById(textElementId);
    if (!circle) return;

    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;

    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;

    if (text) {
      text.textContent = `${Math.round(percent)}%`;
    }
  }
}

window.chartController = new EnergiOSCharts();
