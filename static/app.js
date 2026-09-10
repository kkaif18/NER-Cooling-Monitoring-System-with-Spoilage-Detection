const history = [];
const MAX_POINTS = 120;
let limits = { temp_min: 2.0, temp_max: 8.0, humidity_min: 70.0, humidity_max: 95.0 };

const ICONS = {
  spoilage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  temperature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  humidity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
};

const el = {
  alert: document.getElementById("alert-banner"),
  alertItems: document.getElementById("alert-items"),
  temperature: document.getElementById("temperature"),
  humidity: document.getElementById("humidity"),
  tempRange: document.getElementById("temp-range"),
  humidityRange: document.getElementById("humidity-range"),
  tempMeterBar: document.getElementById("temp-meter-bar"),
  humMeterBar: document.getElementById("hum-meter-bar"),
  spoilageLabel: document.getElementById("spoilage-label"),
  spoilageBadge: document.getElementById("spoilage-badge"),
  spoilageConf: document.getElementById("spoilage-conf"),
  freshnessPct: document.getElementById("freshness-pct"),
  freshnessMeterBar: document.getElementById("freshness-meter-bar"),
  cardTemp: document.getElementById("card-temp"),
  cardHumidity: document.getElementById("card-humidity"),
  cardSpoilage: document.getElementById("card-spoilage"),
  chart: document.getElementById("chart"),
  chartContainer: document.getElementById("chart-container"),
  chartTooltip: document.getElementById("chart-tooltip"),
  localTimezoneName: document.getElementById("local-timezone-name"),

  // Chamber Operations Bar
  chamberStatusDot: document.getElementById("chamber-status-dot"),
  chamberStatusText: document.getElementById("chamber-status-text"),
  scanCountdownRing: document.getElementById("scan-countdown-ring"),
  scanCountdownSec: document.getElementById("scan-countdown-sec"),
  scanCountdownText: document.getElementById("scan-countdown-text"),

  // Live Video Station
  btnBrowserCam: document.getElementById("btn-browser-cam"),
  browserCamText: document.getElementById("browser-cam-text"),
  browserCamVideo: document.getElementById("browser-cam-video"),
  liveDetectionCanvas: document.getElementById("live-detection-canvas"),
  videoPlaceholder: document.getElementById("video-placeholder"),
  streamStatusLabel: document.getElementById("stream-status-label"),
  videoFpsMeter: document.getElementById("video-fps-meter"),
  scanLaserBeam: document.getElementById("scan-laser-beam"),
  browserCamCanvas: document.getElementById("browser-cam-canvas"),

  // Snapshot Station & Audit Log (Separate)
  cameraImage: document.getElementById("camera-image"),
  cameraPlaceholder: document.getElementById("camera-placeholder"),
  cameraMeta: document.getElementById("camera-meta"),
  btnScanNow: document.getElementById("btn-scan-now"),
  toggleSnapshotHeatmap: document.getElementById("toggle-snapshot-heatmap"),
  snapshotHeatmapLabel: document.getElementById("snapshot-heatmap-label"),
  selectSnapshotColormap: document.getElementById("select-snapshot-colormap"),
  detectionIndicatorBadge: document.getElementById("detection-indicator-badge"),
  detectedCondition: document.getElementById("detected-condition"),
  detectedConfidence: document.getElementById("detected-confidence"),
  detectedSeverity: document.getElementById("detected-severity"),
  detectedThermal: document.getElementById("detected-thermal"),
  auditTbody: document.getElementById("audit-tbody"),
  auditCount: document.getElementById("audit-count"),
};

// 1-Minute Auto-Scan Countdown (60s)
let countdownSec = 60;
let countdownTimerId = null;

// Live Camera & Real-Time Detection State
let browserCamStream = null;
let liveRenderAnimFrame = null;
let liveDetectIntervalId = null;
let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 30;

// Latest detection result on live stream
let latestLiveDetection = {
  label: "Scanning...",
  confidence: 0.0,
  spoiled_probability: 0.0,
  severity: 0.0,
  severity_tier: "Scanning",
  is_spoiled: false,
  bbox: null,
};

// Audit Log Array
const auditLog = [];

// Chart Hover State
let chartHoverIndex = -1;

// Set local timezone name in UI
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local Time";
  if (el.localTimezoneName) el.localTimezoneName.textContent = tz;
} catch (e) {}

function initCountdown() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  countdownSec = 60;
  updateCountdownDisplay();
  countdownTimerId = setInterval(() => {
    countdownSec--;
    if (countdownSec <= 0) {
      countdownSec = 60;
      triggerAutoScan();
    }
    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay() {
  if (el.scanCountdownSec) el.scanCountdownSec.textContent = countdownSec;
  if (el.scanCountdownText) el.scanCountdownText.textContent = `Next auto-scan in ${countdownSec}s`;
  if (el.scanCountdownRing) {
    const fraction = (countdownSec / 60) * 100;
    el.scanCountdownRing.setAttribute("stroke-dasharray", `${fraction}, 100`);
  }
}

async function triggerAutoScan() {
  if (browserCamStream && el.browserCamVideo.videoWidth) {
    triggerScanAnimation();
    captureAndUploadArchivalFrame();
  }
}

// Laser scan visual animation
function triggerScanAnimation() {
  if (el.scanLaserBeam) {
    el.scanLaserBeam.classList.remove("hidden");
    setTimeout(() => {
      el.scanLaserBeam.classList.add("hidden");
    }, 1300);
  }
}

// Format ISO string to local time (HH:MM:SS AM/PM)
function formatLocalTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return (iso || "").replace("T", " ").slice(11, 19);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  } catch (err) {
    return (iso || "").replace("T", " ").slice(11, 19);
  }
}

function formatLocalDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 19);
    const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    return `${dateStr} at ${timeStr}`;
  } catch (err) {
    return (iso || "").replace("T", " ").slice(0, 19);
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "snapshot") {
        applySnapshot(msg);
      } else if (msg.type === "reading") {
        applyReading(msg.reading);
        showAlerts(msg.alerts);
      } else if (msg.type === "camera") {
        applyCamera(msg.camera);
        addAuditRecord(msg.camera);
        showAlerts(msg.alerts);
      }
    } catch (err) {
      console.error("Error handling websocket message:", err);
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}

function applySnapshot(msg) {
  if (msg.limits) {
    limits = msg.limits;
    if (el.tempRange) {
      el.tempRange.textContent = `Target: ${msg.limits.temp_min.toFixed(1)} – ${msg.limits.temp_max.toFixed(1)} °C`;
    }
    if (el.humidityRange) {
      el.humidityRange.textContent = `Target: ${msg.limits.humidity_min.toFixed(1)} – ${msg.limits.humidity_max.toFixed(1)} %`;
    }
  }
  history.length = 0;
  (msg.history || []).forEach((row) => history.push(row));
  if (msg.reading && history.length === 0) {
    history.push(msg.reading);
  }
  if (msg.reading) {
    showReading(msg.reading);
  }
  if (msg.camera_history && Array.isArray(msg.camera_history) && msg.camera_history.length) {
    // Populate audit log with recent scans in chronological order
    const chronological = [...msg.camera_history].reverse();
    chronological.forEach((cam) => addAuditRecord(cam));
  } else if (msg.camera) {
    addAuditRecord(msg.camera);
  }
  if (msg.camera) {
    applyCamera(msg.camera);
  }
  showAlerts(msg.alerts);
  drawChart();
}

function applyReading(reading) {
  if (!reading) return;
  showReading(reading);
  history.push(reading);
  if (history.length > MAX_POINTS) history.shift();
  drawChart();
}

function showReading(reading) {
  el.temperature.textContent = reading.temperature.toFixed(1);
  el.humidity.textContent = reading.humidity.toFixed(1);

  const tempOutOfRange = reading.temperature < limits.temp_min || reading.temperature > limits.temp_max;
  const humOutOfRange = reading.humidity < limits.humidity_min || reading.humidity > limits.humidity_max;

  el.cardTemp.classList.toggle("out-of-range", tempOutOfRange);
  el.cardHumidity.classList.toggle("out-of-range", humOutOfRange);

  if (el.tempMeterBar) {
    const tSpan = (limits.temp_max - limits.temp_min) || 6;
    const tPct = Math.min(100, Math.max(10, ((reading.temperature - (limits.temp_min - 2)) / (tSpan + 4)) * 100));
    el.tempMeterBar.style.width = `${tPct}%`;
  }
  if (el.humMeterBar) {
    const hPct = Math.min(100, Math.max(10, reading.humidity));
    el.humMeterBar.style.width = `${hPct}%`;
  }

  // Update Chamber Operations Health Status
  if (el.chamberStatusText && el.chamberStatusDot) {
    if (tempOutOfRange && humOutOfRange) {
      el.chamberStatusText.textContent = "Chamber Alert: Temperature & Humidity Warning";
      el.chamberStatusDot.style.background = "var(--decay-ruby)";
    } else if (tempOutOfRange) {
      el.chamberStatusText.textContent = `Chamber Alert: Temp ${reading.temperature < limits.temp_min ? "Below Safe Hold" : "Above Safe Hold"}`;
      el.chamberStatusDot.style.background = "var(--ember-orange)";
    } else if (humOutOfRange) {
      el.chamberStatusText.textContent = `Chamber Notice: Humidity ${reading.humidity < limits.humidity_min ? "Below Retention Target" : "Saturated"}`;
      el.chamberStatusDot.style.background = "var(--glacier-teal)";
    } else {
      el.chamberStatusText.textContent = "Optimal Cold Storage (Safe Holding Zone)";
      el.chamberStatusDot.style.background = "#22c55e";
    }
  }
}

// Update SEPARATE Last Scanned Inspection Snapshot Section
function applyCamera(camera) {
  if (!camera) return;

  const isSpoiled = Boolean(camera.is_spoiled);
  const confPct = (camera.confidence * 100).toFixed(1);
  const spoiledProb = camera.spoiled_probability != null ? camera.spoiled_probability : (isSpoiled ? 0.9 : 0.05);
  const severity = camera.severity != null ? camera.severity : (spoiledProb * 100);
  const freshnessScore = Math.max(0, Math.min(100, 100 - severity)).toFixed(1);

  // 1. Metric Card (Produce Integrity)
  if (isSpoiled) {
    el.spoilageLabel.textContent = "Spoilage Alert";
    if (el.spoilageBadge) {
      el.spoilageBadge.textContent = "Decay Detected";
      el.spoilageBadge.className = "badge-status status-risk";
    }
  } else {
    el.spoilageLabel.textContent = "Fresh & Sound";
    if (el.spoilageBadge) {
      el.spoilageBadge.textContent = "Optimal Safe";
      el.spoilageBadge.className = "badge-status status-fresh";
    }
  }

  el.cardSpoilage.classList.toggle("is-spoiled", isSpoiled);
  el.spoilageConf.textContent = `Confidence: ${confPct}% (MobileNetV2)`;

  if (el.freshnessPct) el.freshnessPct.textContent = `${freshnessScore}%`;
  if (el.freshnessMeterBar) el.freshnessMeterBar.style.width = `${freshnessScore}%`;

  // 2. Separate Snapshot Panel Display
  if (el.cameraMeta) {
    el.cameraMeta.textContent = formatLocalDateTime(camera.timestamp);
  }

  if (el.cameraImage) {
    const heatmapOn = el.toggleSnapshotHeatmap ? el.toggleSnapshotHeatmap.checked : true;
    const colormap = el.selectSnapshotColormap ? el.selectSnapshotColormap.value : "turbo";
    const view = heatmapOn ? "annotated" : "raw";
    el.cameraImage.src = `/api/image/latest?view=${view}&colormap=${colormap}&heatmap=${heatmapOn}&t=${Date.now()}`;
    el.cameraImage.classList.remove("hidden");
  }
  if (el.cameraPlaceholder) {
    el.cameraPlaceholder.classList.add("hidden");
  }

  if (el.detectionIndicatorBadge) {
    if (isSpoiled) {
      el.detectionIndicatorBadge.textContent = "Decay Hotspot Flagged";
      el.detectionIndicatorBadge.className = "badge-detection badge-detected-spoilage";
    } else {
      el.detectionIndicatorBadge.textContent = "Produce Inspected: Fresh";
      el.detectionIndicatorBadge.className = "badge-detection badge-detected-fresh";
    }
  }

  // 3. Diagnostic Breakdown Grid
  if (el.detectedCondition) {
    el.detectedCondition.textContent = isSpoiled ? "Decay / Quarantine Required" : "Fresh / Chamber Safe";
    el.detectedCondition.className = `diag-val ${isSpoiled ? "val-risk" : "val-fresh"}`;
  }
  if (el.detectedConfidence) {
    el.detectedConfidence.textContent = `${confPct}%`;
  }
  if (el.detectedSeverity) {
    el.detectedSeverity.textContent = `${camera.severity_tier || (isSpoiled ? "Severe Decay" : "Optimal Fresh")} (${severity.toFixed(1)}%)`;
  }
  if (el.detectedThermal) {
    el.detectedThermal.textContent = isSpoiled ? "Decay Hotspot Localized" : "Grad-CAM Produce Saliency Verified";
  }
}

// Add Entry to Inspection Audit Log (Deduplicated)
function addAuditRecord(camera) {
  if (!camera) return;
  const isSpoiled = Boolean(camera.is_spoiled);
  const timeStr = formatLocalTime(camera.timestamp);
  const confPct = (camera.confidence * 100).toFixed(1);
  const latestT = el.temperature && el.temperature.textContent !== "—" ? `${el.temperature.textContent} °C` : "5.1 °C";
  const latestH = el.humidity && el.humidity.textContent !== "—" ? `${el.humidity.textContent} %` : "86.0 %";

  const rawTs = camera.timestamp || "";
  const scanId = camera.id != null ? camera.id : null;

  // Deduplication: prevent duplicate rows for the same scan event
  const exists = auditLog.some((r) => {
    if (scanId != null && r.id != null) return r.id === scanId;
    if (rawTs && r.rawTimestamp) return r.rawTimestamp === rawTs;
    return false;
  });
  if (exists) return;

  const imageUrl = camera.image_url || (scanId ? `/api/image/${scanId}` : "/api/image/latest");

  const record = {
    id: scanId,
    rawTimestamp: rawTs,
    time: timeStr,
    imageUrl: imageUrl,
    condition: camera.label || (isSpoiled ? "Spoiled" : "Fresh"),
    isSpoiled: isSpoiled,
    conf: confPct,
    climate: `${latestT} · ${latestH} RH`,
    recommendation: isSpoiled ? "Quarantine infected produce; check tray humidity." : "Chamber microclimate safe. Produce holding soundly.",
    cameraData: camera,
  };

  auditLog.unshift(record);
  if (auditLog.length > 25) auditLog.pop();
  renderAuditTable();
}

function renderAuditTable() {
  if (!el.auditTbody) return;
  if (auditLog.length === 0) {
    el.auditTbody.innerHTML = `<tr class="empty-audit-row"><td colspan="6">No inspection events logged yet. Click "Scan Chamber Now" to record.</td></tr>`;
    if (el.auditCount) el.auditCount.textContent = "0 Scans";
    return;
  }

  el.auditTbody.innerHTML = auditLog.map((r, idx) => `
    <tr class="audit-row" data-idx="${idx}">
      <td><strong>${r.time}</strong></td>
      <td>
        <div class="audit-thumb-cell">
          <img src="${r.imageUrl}" class="audit-thumb" alt="Scan thumbnail" title="Click to view full scan" onclick="openScanModalByIndex(${idx}); event.stopPropagation();" onerror="this.style.opacity='0.4';">
          <button type="button" class="btn-view-scan" onclick="openScanModalByIndex(${idx}); event.stopPropagation();" title="Inspect this scan image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <span>View Still</span>
          </button>
        </div>
      </td>
      <td>
        <span class="audit-pill ${r.isSpoiled ? "audit-pill-risk" : "audit-pill-fresh"}">
          ${r.isSpoiled ? "⚠️ " + r.condition : "✓ " + r.condition}
        </span>
      </td>
      <td>${r.conf}%</td>
      <td>${r.climate}</td>
      <td>${r.recommendation}</td>
    </tr>
  `).join("");

  if (el.auditCount) el.auditCount.textContent = `${auditLog.length} Scans`;
}

// Modal inspection state & methods
let currentModalRecord = null;

function openScanModalByIndex(idx) {
  const record = auditLog[idx];
  if (!record) return;
  openScanModal(record);
}

function openScanModal(record) {
  currentModalRecord = record;
  const modal = document.getElementById("scan-modal");
  const modalImg = document.getElementById("scan-modal-img");
  const modalTitle = document.getElementById("modal-scan-title");
  const modalTime = document.getElementById("modal-scan-time");
  const modalCond = document.getElementById("modal-scan-condition");
  const modalConf = document.getElementById("modal-scan-conf");
  const modalClimate = document.getElementById("modal-scan-climate");
  const modalRec = document.getElementById("modal-scan-rec");

  if (!modal) return;

  if (modalTitle) modalTitle.textContent = record.id ? `Chamber Inspection Still · Scan #${record.id}` : "Chamber Inspection Still";
  if (modalTime) modalTime.textContent = record.rawTimestamp ? formatLocalDateTime(record.rawTimestamp) : record.time;
  if (modalImg) {
    const separator = record.imageUrl.includes("?") ? "&" : "?";
    modalImg.src = `${record.imageUrl}${separator}v=${Date.now()}`;
  }
  if (modalCond) {
    modalCond.textContent = record.condition;
    modalCond.className = `modal-meta-val ${record.isSpoiled ? "val-risk" : "val-fresh"}`;
  }
  if (modalConf) modalConf.textContent = `${record.conf}%`;
  if (modalClimate) modalClimate.textContent = record.climate;
  if (modalRec) modalRec.textContent = record.recommendation;

  modal.classList.remove("hidden");
}

function closeScanModal() {
  const modal = document.getElementById("scan-modal");
  if (modal) modal.classList.add("hidden");
}

// Wire modal controls
const modalCloseBtn = document.getElementById("btn-modal-close");
const modalDismissBtn = document.getElementById("btn-modal-dismiss");
const modalBackdrop = document.getElementById("scan-modal-backdrop");
const modalLoadViewportBtn = document.getElementById("btn-modal-load-viewport");

if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeScanModal);
if (modalDismissBtn) modalDismissBtn.addEventListener("click", closeScanModal);
if (modalBackdrop) modalBackdrop.addEventListener("click", closeScanModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeScanModal();
});

if (modalLoadViewportBtn) {
  modalLoadViewportBtn.addEventListener("click", () => {
    if (currentModalRecord && currentModalRecord.cameraData) {
      applyCamera(currentModalRecord.cameraData);
      closeScanModal();
      // Smooth scroll up to the snapshot panel
      const snapshotEl = document.querySelector(".snapshot-station-panel");
      if (snapshotEl) snapshotEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

let isBrowserCamActive = false;

// "Scan Chamber Now" Button handler (Now in Scanned Image Section)
if (el.btnScanNow) {
  el.btnScanNow.addEventListener("click", async () => {
    el.btnScanNow.classList.add("scanning");
    const labelSpan = el.btnScanNow.querySelector("span");
    const originalText = labelSpan ? labelSpan.textContent : "Scan Chamber Now";
    if (labelSpan) labelSpan.textContent = "Scanning...";

    triggerScanAnimation();

    if (isBrowserCamActive && browserCamStream && el.browserCamVideo.videoWidth) {
      captureAndUploadArchivalFrame();
    } else {
      alert("Please turn on the Browser Webcam first.");
    }

    countdownSec = 60;
    updateCountdownDisplay();

    setTimeout(() => {
      el.btnScanNow.classList.remove("scanning");
      if (labelSpan) labelSpan.textContent = originalText;
    }, 1300);
  });
}

// Scanned Image Heatmap & Palette Controls
function refreshScannedImage() {
  const heatmapOn = el.toggleSnapshotHeatmap ? el.toggleSnapshotHeatmap.checked : true;
  const colormap = el.selectSnapshotColormap ? el.selectSnapshotColormap.value : "turbo";
  const view = heatmapOn ? "annotated" : "raw";

  if (el.snapshotHeatmapLabel) {
    el.snapshotHeatmapLabel.textContent = heatmapOn ? "ON" : "OFF";
  }

  if (el.cameraImage && el.cameraImage.src && !el.cameraImage.classList.contains("hidden")) {
    el.cameraImage.src = `/api/image/latest?view=${view}&colormap=${colormap}&heatmap=${heatmapOn}&t=${Date.now()}`;
  }
}

if (el.toggleSnapshotHeatmap) {
  el.toggleSnapshotHeatmap.addEventListener("change", refreshScannedImage);
}

if (el.selectSnapshotColormap) {
  el.selectSnapshotColormap.addEventListener("change", refreshScannedImage);
}

// ==========================================
// REAL-TIME VIDEO & LIVE DETECTION OVERLAY
// ==========================================
function startLiveVideoRender() {
  const canvas = el.liveDetectionCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function renderLoop() {
    let sourceW = 0;
    let sourceH = 0;

    if (isBrowserCamActive && browserCamStream && el.browserCamVideo.videoWidth) {
      sourceW = el.browserCamVideo.videoWidth;
      sourceH = el.browserCamVideo.videoHeight;
    }

    if (sourceW && sourceH) {
      if (canvas.width !== sourceW || canvas.height !== sourceH) {
        canvas.width = sourceW;
        canvas.height = sourceH;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw real-time detection bounding box & HUD over video
      drawLiveDetectionOverlay(ctx, canvas.width, canvas.height);

      // Calculate display FPS
      frameCount++;
      const now = performance.now();
      if (now - lastFrameTime >= 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastFrameTime));
        frameCount = 0;
        lastFrameTime = now;
        if (el.videoFpsMeter) el.videoFpsMeter.textContent = `${fps} FPS Live Stream`;
      }
    }
    liveRenderAnimFrame = requestAnimationFrame(renderLoop);
  }

  liveRenderAnimFrame = requestAnimationFrame(renderLoop);
}

// Draw detection bounding box, corners, and tag directly over live video
function drawLiveDetectionOverlay(ctx, w, h) {
  const d = latestLiveDetection;
  const isSpoiled = d.is_spoiled;
  const statusColor = isSpoiled ? "#ef4444" : "#22c55e";

  // Corner Bounding Box
  let bx = w * 0.18;
  let by = h * 0.18;
  let bw = w * 0.64;
  let bh = h * 0.64;

  if (d.bbox) {
    bx = d.bbox[0];
    by = d.bbox[1];
    bw = d.bbox[2];
    bh = d.bbox[3];
  }

  const bl = Math.min(26, bw / 3, bh / 3);
  ctx.save();
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  // Box rectangle
  ctx.strokeRect(bx, by, bw, bh);

  // High-tech corner accents
  ctx.lineWidth = 5;
  // Top-left
  ctx.beginPath(); ctx.moveTo(bx, by + bl); ctx.lineTo(bx, by); ctx.lineTo(bx + bl, by); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(bx + bw - bl, by); ctx.lineTo(bx + bw); ctx.lineTo(bx + bw, by + bl); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(bx, by + bh - bl); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + bl, by + bh); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(bx + bw - bl, by + bh); ctx.lineTo(bx + bw); ctx.lineTo(bx + bw, by + bh - bl); ctx.stroke();

  // Callout Tag
  const confText = d.confidence > 0 ? ` (${(d.confidence * 100).toFixed(0)}%)` : "";
  const tagText = isSpoiled
    ? `SPOILAGE DETECTED: ROT HOTSPOT${confText}`
    : `PRODUCE LOCATED: FRESH${confText}`;

  ctx.font = "bold 12px sans-serif";
  const tw = ctx.measureText(tagText).width;
  const tagY = Math.max(26, by - 8);

  ctx.fillStyle = "rgba(10, 24, 16, 0.90)";
  ctx.fillRect(bx, tagY - 20, tw + 16, 22);
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, tagY - 20, tw + 16, 22);

  ctx.fillStyle = statusColor;
  ctx.fillText(tagText, bx + 8, tagY - 5);

  ctx.restore();
}

// Periodic live detection (in-memory, no disk writes!)
async function runLiveDetectionCycle() {
  const canvas = el.browserCamCanvas;
  if (!canvas) return;

  if (!isBrowserCamActive) {
    const banner = document.getElementById("lighting-suggestion");
    if (banner) banner.classList.add("hidden");
    return;
  }

  let sourceElem = null;
  if (isBrowserCamActive && browserCamStream && el.browserCamVideo.videoWidth) {
    sourceElem = el.browserCamVideo;
  }
  if (!sourceElem) return;

  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(sourceElem, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    return;
  }

  // --- Real-Time Brightness & Lighting Check ---
  try {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0, g = 0, b = 0, count = 0;
    // Sample every 16th pixel to save CPU
    for (let i = 0; i < imgData.data.length; i += 4 * 16) {
      r += imgData.data[i];
      g += imgData.data[i + 1];
      b += imgData.data[i + 2];
      count++;
    }
    const brightness = (r + g + b) / (3 * count);
    
    const banner = document.getElementById("lighting-suggestion");
    const bannerText = document.getElementById("lighting-text");
    if (banner && bannerText) {
      banner.classList.remove("hidden");
      if (brightness < 70) {
        banner.className = "lighting-suggestion-banner warning";
        bannerText.textContent = "Too dark! Increase lighting for accurate AI scan.";
      } else if (brightness > 210) {
        banner.className = "lighting-suggestion-banner warning";
        bannerText.textContent = "Too bright or washed out. Reduce glare.";
      } else {
        banner.className = "lighting-suggestion-banner good";
        bannerText.textContent = "Lighting is good. Ensure plain background for best accuracy.";
      }
    }
  } catch (err) {
    // Ignore cross-origin canvas errors for now
  }
  // ---------------------------------------------

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const formData = new FormData();
    formData.append("image", blob, "live.jpg");
    try {
      const res = await fetch("/api/ingest/live-detect", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok && data.detection) {
        const nativeW = sourceElem.videoWidth || sourceElem.naturalWidth || 640;
        const nativeH = sourceElem.videoHeight || sourceElem.naturalHeight || 480;
        const scaleX = nativeW / 320;
        const scaleY = nativeH / 240;

        let scaledBbox = null;
        if (data.detection.bbox) {
          scaledBbox = [
            Math.round(data.detection.bbox[0] * scaleX),
            Math.round(data.detection.bbox[1] * scaleY),
            Math.round(data.detection.bbox[2] * scaleX),
            Math.round(data.detection.bbox[3] * scaleY),
          ];
        }

        latestLiveDetection = {
          label: data.detection.label,
          confidence: data.detection.confidence,
          spoiled_probability: data.detection.spoiled_probability,
          severity: data.detection.severity,
          severity_tier: data.detection.severity_tier,
          is_spoiled: data.detection.is_spoiled,
          bbox: scaledBbox,
        };
      }
    } catch (e) {
      // Live detection silent failover
    }
  }, "image/jpeg", 0.75);
}

// Browser Webcam Controls
async function startBrowserWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    browserCamStream = stream;
    isBrowserCamActive = true;
    el.browserCamVideo.srcObject = stream;
    el.browserCamVideo.classList.remove("hidden");
    await el.browserCamVideo.play();

    el.btnBrowserCam.classList.add("active-streaming");
    el.browserCamText.textContent = "Stop Camera";
    if (el.videoPlaceholder) el.videoPlaceholder.classList.add("hidden");
    if (el.streamStatusLabel) el.streamStatusLabel.textContent = "Webcam Live";

    // Start 30 FPS video overlay loop
    startLiveVideoRender();

    // Start periodic live detection cycle (every 1.2s)
    if (liveDetectIntervalId) clearInterval(liveDetectIntervalId);
    liveDetectIntervalId = setInterval(runLiveDetectionCycle, 1200);

    // Initial archival snapshot capture
    setTimeout(captureAndUploadArchivalFrame, 1000);
  } catch (err) {
    console.error("Camera access error:", err);
  }
}

function stopBrowserWebcamOnly() {
  if (browserCamStream) {
    browserCamStream.getTracks().forEach((t) => t.stop());
    browserCamStream = null;
  }
  if (el.browserCamVideo) {
    el.browserCamVideo.srcObject = null;
    el.browserCamVideo.classList.add("hidden");
  }
  el.btnBrowserCam.classList.remove("active-streaming");
  el.browserCamText.textContent = "Use Browser Webcam";
}

function stopBrowserWebcam() {
  if (liveRenderAnimFrame) {
    cancelAnimationFrame(liveRenderAnimFrame);
    liveRenderAnimFrame = null;
  }
  if (liveDetectIntervalId) {
    clearInterval(liveDetectIntervalId);
    liveDetectIntervalId = null;
  }
  stopBrowserWebcamOnly();
  isBrowserCamActive = false;
  if (el.videoPlaceholder) el.videoPlaceholder.classList.remove("hidden");
  if (el.streamStatusLabel) el.streamStatusLabel.textContent = "Standby";


  const ctx = el.liveDetectionCanvas.getContext("2d");
  ctx.clearRect(0, 0, el.liveDetectionCanvas.width, el.liveDetectionCanvas.height);

  // Hide lighting suggestion when camera disconnects
  const banner = document.getElementById("lighting-suggestion");
  if (banner) banner.classList.add("hidden");
}

// Capture archival frame for snapshot section (from browser video)
function captureAndUploadArchivalFrame() {
  if (!browserCamStream || !el.browserCamVideo.videoWidth) return;

  const canvas = el.browserCamCanvas;
  canvas.width = el.browserCamVideo.videoWidth;
  canvas.height = el.browserCamVideo.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(el.browserCamVideo, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const formData = new FormData();
    formData.append("image", blob, "archival_still.jpg");
    try {
      const res = await fetch("/api/ingest/image", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.camera) {
        applyCamera(data.camera);
        addAuditRecord(data.camera);
        showAlerts(data.alerts);
      }
    } catch (err) {
      console.warn("Archival frame upload warning:", err);
    }
  }, "image/jpeg", 0.92);
}

if (el.btnBrowserCam) {
  el.btnBrowserCam.addEventListener("click", () => {
    if (browserCamStream) {
      stopBrowserWebcam();
    } else {
      startBrowserWebcam();
    }
  });
}

function alertKind(text) {
  const lower = text.toLowerCase();
  if (lower.includes("spoil")) return "spoilage";
  if (lower.includes("humid")) return "humidity";
  if (lower.includes("temp")) return "temperature";
  return "spoilage";
}

function showAlerts(alerts) {
  if (!alerts || !alerts.length) {
    el.alert.classList.add("hidden");
    el.alertItems.innerHTML = "";
    return;
  }

  el.alertItems.innerHTML = alerts.map((text) => {
    const kind = alertKind(text);
    return `<div class="alert-item alert-${kind}">
      <span class="alert-icon">${ICONS[kind]}</span>
      <span class="alert-text">${text}</span>
    </div>`;
  }).join("");
  el.alert.classList.remove("hidden");
}

function niceTicks(min, max, count) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = mag;
  if (norm >= 5) step = 5 * mag;
  else if (norm >= 2) step = 2 * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

// ========================================================
// HIGH-TECH TELEMETRY GRAPH WITH LOCAL TIME & HOVER TOOLTIP
// ========================================================
function drawChart() {
  const canvas = el.chart;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 1000;
  const cssH = 330;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  // Dark High-Tech Background
  ctx.fillStyle = "#0c1a12";
  ctx.fillRect(0, 0, cssW, cssH);

  if (history.length < 2) {
    ctx.fillStyle = "#6d8274";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Connecting to chamber microclimate sensors…", cssW / 2, cssH / 2);
    return;
  }

  const pad = { left: 56, right: 56, top: 22, bottom: 38 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const temps = history.map((p) => p.temperature);
  const hums = history.map((p) => p.humidity);

  const tMin = Math.min(limits.temp_min - 1.5, Math.min(...temps) - 0.5);
  const tMax = Math.max(limits.temp_max + 1.5, Math.max(...temps) + 0.5);
  const hMin = Math.min(limits.humidity_min - 6, Math.min(...hums) - 1.5);
  const hMax = Math.max(limits.humidity_max + 2, Math.max(...hums) + 1.5);

  const tTicks = niceTicks(tMin, tMax, 5);
  const hTicks = niceTicks(hMin, hMax, 5);

  function xAt(i) {
    return pad.left + (i / (history.length - 1)) * plotW;
  }
  function yTemp(v) {
    return pad.top + (1 - (v - tMin) / (tMax - tMin || 1)) * plotH;
  }
  function yHum(v) {
    return pad.top + (1 - (v - hMin) / (hMax - hMin || 1)) * plotH;
  }

  // 1. Shaded Optimal Safe Storage Band
  const safeTop = yTemp(limits.temp_max);
  const safeBot = yTemp(limits.temp_min);
  ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
  ctx.fillRect(pad.left, Math.min(safeTop, safeBot), plotW, Math.abs(safeBot - safeTop));

  ctx.fillStyle = "rgba(74, 222, 128, 0.75)";
  ctx.font = "600 11px 'Plus Jakarta Sans', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Safe Storage Hold Band (2–8 °C)", pad.left + plotW - 10, Math.min(safeTop, safeBot) + 14);

  // 2. Horizontal Gridlines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  tTicks.forEach((tick) => {
    const y = yTemp(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  });

  // 3. Vertical Local Time Gridlines & Labels
  const timeIndexes = [0, Math.floor((history.length - 1) / 4), Math.floor((history.length - 1) / 2), Math.floor((3 * (history.length - 1)) / 4), history.length - 1];
  ctx.fillStyle = "#86efac";
  ctx.font = "500 11px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  timeIndexes.forEach((i) => {
    const x = xAt(i);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(formatLocalTime(history[i].timestamp), x, cssH - 12);
  });

  // 4. Axis Values
  ctx.textAlign = "right";
  ctx.fillStyle = "#ff8800";
  ctx.font = "600 11px 'Space Grotesk', sans-serif";
  tTicks.forEach((tick) => {
    ctx.fillText(String(tick), pad.left - 8, yTemp(tick) + 4);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "#00d2d3";
  hTicks.forEach((tick) => {
    ctx.fillText(String(tick), pad.left + plotW + 8, yHum(tick) + 4);
  });

  // 5. Y-Axis Titles
  ctx.save();
  ctx.translate(16, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff8800";
  ctx.font = "700 11px 'Plus Jakarta Sans', sans-serif";
  ctx.fillText("TEMPERATURE (°C)", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(cssW - 14, pad.top + plotH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#00d2d3";
  ctx.font = "700 11px 'Plus Jakarta Sans', sans-serif";
  ctx.fillText("HUMIDITY (%)", 0, 0);
  ctx.restore();

  // 6. Area Glow Under Temperature
  ctx.beginPath();
  temps.forEach((v, i) => {
    const x = xAt(i);
    const y = yTemp(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xAt(temps.length - 1), pad.top + plotH);
  ctx.lineTo(xAt(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 136, 0, 0.09)";
  ctx.fill();

  // 7. Humidity Line (Glacier Cyan)
  ctx.beginPath();
  hums.forEach((v, i) => {
    const x = xAt(i);
    const y = yHum(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#00d2d3";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // 8. Temperature Line (Ember Orange)
  ctx.beginPath();
  temps.forEach((v, i) => {
    const x = xAt(i);
    const y = yTemp(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#ff8800";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // 9. Glowing Point Dots
  const markEvery = Math.max(1, Math.floor(history.length / 20));
  for (let i = 0; i < history.length; i += markEvery) {
    ctx.fillStyle = "#ff8800";
    ctx.beginPath();
    ctx.arc(xAt(i), yTemp(temps[i]), 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#00d2d3";
    ctx.beginPath();
    ctx.arc(xAt(i), yHum(hums[i]), 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 10. Interactive Crosshair on Hover
  if (chartHoverIndex >= 0 && chartHoverIndex < history.length) {
    const hx = xAt(chartHoverIndex);
    ctx.strokeStyle = "rgba(74, 222, 128, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, pad.top);
    ctx.lineTo(hx, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const pt = history[chartHoverIndex];
    ctx.fillStyle = "#ff8800";
    ctx.beginPath();
    ctx.arc(hx, yTemp(pt.temperature), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, yTemp(pt.temperature), 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#00d2d3";
    ctx.beginPath();
    ctx.arc(hx, yHum(pt.humidity), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, yHum(pt.humidity), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 11. Plot Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);
}

// Chart Mouse Interactivity
if (el.chart) {
  el.chart.addEventListener("mousemove", (e) => {
    if (history.length < 2) return;
    const rect = el.chart.getBoundingClientRect();
    const pad = { left: 56, right: 56 };
    const plotW = (el.chart.clientWidth || 1000) - pad.left - pad.right;
    const mouseX = e.clientX - rect.left - pad.left;

    if (mouseX < 0 || mouseX > plotW) {
      chartHoverIndex = -1;
      if (el.chartTooltip) el.chartTooltip.classList.add("hidden");
      drawChart();
      return;
    }

    const fraction = mouseX / plotW;
    chartHoverIndex = Math.min(history.length - 1, Math.max(0, Math.round(fraction * (history.length - 1))));

    if (el.chartTooltip) {
      const pt = history[chartHoverIndex];
      el.chartTooltip.innerHTML = `
        <div class="tooltip-time">Local Time: ${formatLocalTime(pt.timestamp)}</div>
        <div class="tooltip-row"><span style="color:#ff8800">Temperature:</span> <strong>${pt.temperature.toFixed(1)} °C</strong></div>
        <div class="tooltip-row"><span style="color:#00d2d3">Humidity:</span> <strong>${pt.humidity.toFixed(1)} %</strong></div>
      `;
      el.chartTooltip.style.left = `${e.clientX - rect.left}px`;
      el.chartTooltip.style.top = `${e.clientY - rect.top}px`;
      el.chartTooltip.classList.remove("hidden");
    }
    drawChart();
  });

  el.chart.addEventListener("mouseleave", () => {
    chartHoverIndex = -1;
    if (el.chartTooltip) el.chartTooltip.classList.add("hidden");
    drawChart();
  });
}

window.addEventListener("resize", drawChart);
initCountdown();
connect();
