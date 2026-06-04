/* app.js — PDF OCR Tool v3 */

let currentJobId    = null;
let totalPageCount  = 0;
let selectedFormat  = "docx";
let sectionCounter  = 0;
let detectedSections = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone      = document.getElementById("dropZone");
const fileInput     = document.getElementById("fileInput");
const extractBtn    = document.getElementById("extractBtn");
const downloadBtn   = document.getElementById("downloadBtn");
const progressFill  = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const resultsContainer = document.getElementById("resultsContainer");

// ── Upload ────────────────────────────────────────────────────────────────────
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()=> dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("drag-over"); if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFileUpload(fileInput.files[0]); });

async function handleFileUpload(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) { alert("Please upload a PDF file."); return; }
  dropZone.querySelector(".drop-text").textContent = "Uploading…";
  dropZone.style.pointerEvents = "none";
  const fd = new FormData(); fd.append("pdf", file);
  try {
    const res  = await fetch("/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    currentJobId   = data.job_id;
    totalPageCount = data.page_count;
    document.getElementById("fileName").textContent      = data.filename;
    document.getElementById("fileMeta").textContent      = `${(file.size/1024/1024).toFixed(2)} MB`;
    document.getElementById("pageCountBadge").textContent = `${data.page_count} pages`;
    document.getElementById("fileInfo").style.display    = "flex";
    // Pre-fill page offset hints
    document.getElementById("tocEnd").value = Math.min(8, data.page_count);
    document.getElementById("kwEnd").placeholder = data.page_count;
    initSections();
    const cfg = document.getElementById("step-configure");
    cfg.style.display = "block";
    cfg.scrollIntoView({ behavior:"smooth", block:"start" });
    dropZone.querySelector(".drop-text").textContent = "Drag & drop another PDF";
    dropZone.style.pointerEvents = "auto";
  } catch (err) {
    alert("Upload error: " + err.message);
    dropZone.querySelector(".drop-text").textContent = "Drag & drop your PDF here";
    dropZone.style.pointerEvents = "auto";
  }
}

// ── Auto-detect panel ─────────────────────────────────────────────────────────
function toggleAutoDetect() {
  const body = document.getElementById("autoDetectBody");
  const icon = document.getElementById("autoDetectIcon");
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "block";
  icon.style.transform = open ? "rotate(-90deg)" : "rotate(0deg)";
}

function setDetectTab(tab) {
  document.querySelectorAll(".detect-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.getElementById("detect-toc").style.display     = tab === "toc"     ? "block" : "none";
  document.getElementById("detect-keyword").style.display = tab === "keyword" ? "block" : "none";
  clearPreview();
}

// ── ToC scan ──────────────────────────────────────────────────────────────────
async function scanToc() {
  if (!currentJobId) { alert("Upload a PDF first."); return; }
  const btn = document.getElementById("tocScanBtn");
  btn.disabled = true; btn.textContent = "⏳ Extracting…";

  const body = {
    job_id:    currentJobId,
    toc_start: parseInt(document.getElementById("tocStart").value) || 1,
    toc_end:   parseInt(document.getElementById("tocEnd").value)   || 5,
    lang:      document.getElementById("lang").value,
    offset:    0
  };

  try {
    const res  = await fetch("/scan-toc", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById("tocRawText").value = data.raw_text || "";
    document.getElementById("tocRawPanel").style.display = "block";
    btn.style.display = "none";
  } catch (err) {
    alert("ToC extraction error: " + err.message);
    btn.disabled = false; btn.textContent = "🔍 Extract ToC Text";
  }
}

async function parseTocText() {
  const btn = document.getElementById("tocParseBtn");
  btn.disabled = true; btn.textContent = "⏳ Parsing…";

  const body = {
    job_id:   currentJobId,
    raw_text: document.getElementById("tocRawText").value,
    offset:   parseInt(document.getElementById("tocOffset").value) || 0
  };

  try {
    const res  = await fetch("/parse-toc-raw", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.sections || data.sections.length === 0) {
      alert("Could not detect sections from the text provided. Ensure lines look like 'Chapter Name 123'.");
    } else {
      showPreview(data.sections);
    }
  } catch (err) {
    alert("Parsing error: " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "⚡ Parse into Sections";
  }
}

// ── Keyword scan (SSE) ────────────────────────────────────────────────────────
async function scanKeyword() {
  if (!currentJobId) { alert("Upload a PDF first."); return; }
  const kw = document.getElementById("kwKeyword").value.trim();
  if (!kw) { alert("Enter a keyword."); return; }

  const btn = document.getElementById("kwScanBtn");
  btn.disabled = true; btn.textContent = "⏳ Scanning…";

  const progressWrap = document.getElementById("kwProgressWrap");
  const progressFill = document.getElementById("kwProgressFill");
  const progressLabel= document.getElementById("kwProgressLabel");
  const foundLog     = document.getElementById("kwFoundLog");
  progressWrap.style.display = "block";
  progressFill.style.width   = "0%";
  foundLog.innerHTML         = "";
  clearPreview();

  const body = {
    job_id:     currentJobId,
    keyword:    kw,
    use_regex:  document.getElementById("kwRegex").checked,
    scan_start: parseInt(document.getElementById("kwStart").value) || 1,
    scan_end:   parseInt(document.getElementById("kwEnd").value)   || 0,
    lang:       "eng"   // header scan, English is fastest
  };

  try {
    const res    = await fetch("/scan-keyword", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop();
      for (const chunk of parts) {
        const line = chunk.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const p = JSON.parse(line.slice(5).trim());
          if (p.type === "progress") {
            progressFill.style.width  = `${p.pct}%`;
            progressLabel.textContent = `Scanning page ${p.page} of ${p.total + body.scan_start - 1} — ${p.pct}%`;
            if (p.found && p.match) {
              const el = document.createElement("div");
              el.className = "found-entry";
              el.textContent = `📌 Page ${p.page}: ${p.match}`;
              foundLog.appendChild(el);
              foundLog.scrollTop = foundLog.scrollHeight;
            }
          } else if (p.type === "done") {
            progressLabel.textContent = `✅ Done — ${p.total_found} section${p.total_found !== 1 ? "s" : ""} found`;
            if (p.sections?.length) showPreview(p.sections);
            else alert("No pages found containing '" + kw + "'. Try a different keyword or page range.");
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    alert("Keyword scan error: " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "🔍 Scan Pages";
  }
}

// ── Preview of detected sections ──────────────────────────────────────────────
function showPreview(sections) {
  detectedSections = sections;
  renderPreview();
  const panel = document.getElementById("detectPreview");
  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderPreview() {
  const list  = document.getElementById("previewList");
  const count = document.getElementById("previewCount");
  
  count.textContent = `${detectedSections.length} section${detectedSections.length !== 1 ? "s" : ""} detected`;
  list.innerHTML    = "";

  detectedSections.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "preview-item";
    row.innerHTML = `
      <input type="text" value="${escapeAttr(s.name)}" onchange="detectedSections[${i}].name = this.value" placeholder="Section name" />
      <span class="preview-pages">p.${s.start}–${s.end}</span>
      <button class="btn-remove-sm" onclick="removeDetectedSection(${i})" title="Remove this section">✕</button>
    `;
    list.appendChild(row);
  });
}

function removeDetectedSection(index) {
  // Save any unsaved name edits before re-rendering
  document.querySelectorAll("#previewList .preview-item input").forEach((inp, i) => {
    if (detectedSections[i]) detectedSections[i].name = inp.value;
  });

  // Remove the section
  detectedSections.splice(index, 1);
  
  // Recalculate end pages
  detectedSections.forEach((s, i) => {
    s.end = (i + 1 < detectedSections.length) ? detectedSections[i+1].start - 1 : totalPageCount;
  });
  
  // Re-render UI
  renderPreview();
}

function clearPreview() {
  document.getElementById("detectPreview").style.display = "none";
  document.getElementById("previewList").innerHTML       = "";
  detectedSections = [];
}

function applyDetectedSections() {
  if (!detectedSections.length) return;
  // Read any name edits from inputs
  document.querySelectorAll("#previewList .preview-item input").forEach((inp, i) => {
    if (detectedSections[i]) detectedSections[i].name = inp.value;
  });
  // Replace sections list
  sectionCounter = 0;
  document.getElementById("sectionsList").innerHTML = "";
  detectedSections.forEach(s => addSection(s.name, s.start, s.end));
  clearPreview();
  // Close auto-detect panel
  document.getElementById("autoDetectBody").style.display = "none";
  document.getElementById("autoDetectIcon").style.transform = "rotate(-90deg)";
  document.getElementById("sectionsList").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Sections manager ──────────────────────────────────────────────────────────
function initSections() {
  sectionCounter = 0;
  document.getElementById("sectionsList").innerHTML = "";
  addSection("Full Document", 1, totalPageCount);
}

function addSection(name = "", start = 1, end = null) {
  sectionCounter++;
  const id  = sectionCounter;
  const endV = end !== null ? end : totalPageCount;
  const row  = document.createElement("div");
  row.className = "section-row"; row.id = `section-row-${id}`;
  row.innerHTML = `
    <div class="section-row-inner">
      <div class="form-group">
        <label>Section Name</label>
        <input type="text" id="sec-name-${id}" value="${escapeAttr(name)}" placeholder="e.g. Chapter 26 — Bhava Lords" />
      </div>
      <div class="form-group">
        <label>Start Page</label>
        <input type="number" id="sec-start-${id}" value="${start}" min="1" max="${totalPageCount}" />
      </div>
      <div class="form-group">
        <label>End Page</label>
        <input type="number" id="sec-end-${id}" value="${endV}" min="1" max="${totalPageCount}" />
      </div>
      <button class="btn-remove" onclick="removeSection(${id})">✕</button>
    </div>`;
  document.getElementById("sectionsList").appendChild(row);
}

function removeSection(id) {
  document.getElementById(`section-row-${id}`)?.remove();
  if (!document.getElementById("sectionsList").children.length) addSection();
}

function getSections() {
  const sections = [];
  for (const row of document.getElementById("sectionsList").children) {
    const m = row.id.match(/section-row-(\d+)/);
    if (!m) continue;
    const id = m[1];
    sections.push({
      name:  document.getElementById(`sec-name-${id}`)?.value.trim()  || `Section ${id}`,
      start: parseInt(document.getElementById(`sec-start-${id}`)?.value) || 1,
      end:   parseInt(document.getElementById(`sec-end-${id}`)?.value)   || totalPageCount
    });
  }
  return sections;
}

// ── Format selector ───────────────────────────────────────────────────────────
function setFormat(fmt) {
  selectedFormat = fmt;
  document.querySelectorAll(".format-tab").forEach(t => t.classList.toggle("active", t.dataset.fmt === fmt));
}

// ── Extract ───────────────────────────────────────────────────────────────────
async function startExtraction() {
  if (!currentJobId) { alert("Upload a PDF first."); return; }
  const sections = getSections();
  if (!sections.length) { alert("Add at least one section."); return; }
  for (const s of sections) {
    if (s.start < 1 || s.end < s.start) { alert(`Section "${s.name}": invalid range.`); return; }
    if (s.end > totalPageCount) { alert(`Section "${s.name}": end page exceeds PDF.`); return; }
  }
  const lang = document.getElementById("lang").value;
  const dpi  = parseInt(document.getElementById("dpi").value);

  const stepResults = document.getElementById("step-results");
  stepResults.style.display = "block";
  resultsContainer.innerHTML = "";
  progressFill.style.width   = "0%";
  progressLabel.textContent  = "Starting…";
  downloadBtn.style.display  = "none";
  extractBtn.disabled        = true;

  for (const s of sections) {
    buildSectionContainer(s);
    for (let p = s.start; p <= s.end; p++) {
      document.querySelector(`#pages-${safeDomId(s.name)}`).appendChild(createPageCard(p, null));
    }
  }
  stepResults.scrollIntoView({ behavior:"smooth", block:"start" });

  const res    = await fetch("/extract", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({job_id:currentJobId, sections, lang, dpi}) });
  const reader = res.body.getReader();
  const dec    = new TextDecoder(); let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream:true });
    const parts = buf.split("\n\n"); buf = parts.pop();
    for (const chunk of parts) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try { handleSSE(JSON.parse(line.slice(5).trim())); } catch(_) {}
    }
  }
  extractBtn.disabled = false;
}

function handleSSE(p) {
  if (p.type === "page") {
    progressFill.style.width  = `${Math.round(p.done/p.total*100)}%`;
    progressLabel.textContent = `Page ${p.page} — ${p.section} (${p.done}/${p.total})`;
    updatePageCard(p.page, p.text);
    loadThumbnail(p.page);
  } else if (p.type === "done") {
    progressFill.style.width  = "100%";
    progressLabel.textContent = "✅ All sections extracted!";
    downloadBtn.style.display = "inline-flex";
  } else if (p.type === "error") {
    updatePageCard(p.page, `⚠️ ${p.text}`);
  }
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadResult() { window.location = `/download/${currentJobId}/${selectedFormat}`; }

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetTool() {
  currentJobId = null; totalPageCount = 0;
  document.getElementById("fileInfo").style.display        = "none";
  document.getElementById("step-configure").style.display  = "none";
  document.getElementById("step-results").style.display    = "none";
  resultsContainer.innerHTML = ""; fileInput.value = "";
  dropZone.querySelector(".drop-text").textContent = "Drag & drop your PDF here";
  window.scrollTo({ top:0, behavior:"smooth" });
}

// ── Results builders ──────────────────────────────────────────────────────────
function buildSectionContainer(section) {
  const el = document.createElement("div");
  el.className = "result-section";
  const domId = safeDomId(section.name);
  const count = section.end - section.start + 1;
  el.innerHTML = `
    <div class="result-section-header">
      <span class="result-section-icon">📂</span>
      <span class="result-section-name">${escapeHtml(section.name)}</span>
      <span class="result-section-pages">Pages ${section.start}–${section.end} · ${count} page${count!==1?'s':''}</span>
    </div>
    <div id="pages-${domId}"></div>`;
  resultsContainer.appendChild(el);
}

function createPageCard(pageNum, text) {
  const card = document.createElement("div");
  card.className = "page-card"; card.id = `page-card-${pageNum}`;
  const isLoading = text === null;
  card.innerHTML = `
    <div class="page-card-header" onclick="toggleCard(${pageNum})">
      <div class="page-label">
        <span class="page-number-pill">Page ${pageNum}</span>
        <span class="page-char-count" id="char-count-${pageNum}">${isLoading ? "Loading…" : text.length+" chars"}</span>
      </div>
      <span class="collapse-icon">▼</span>
    </div>
    <div class="page-card-body">
      <div class="page-thumb" id="thumb-${pageNum}"><div class="page-thumb-placeholder">🖼</div></div>
      <div class="page-text ${isLoading?"loading":""}" id="page-text-${pageNum}">
        ${isLoading ? '<div class="spinner"></div><span>Running OCR…</span>' : escapeHtml(text)}
      </div>
    </div>`;
  return card;
}

function updatePageCard(pageNum, text) {
  const el = document.getElementById(`page-text-${pageNum}`);
  const ch = document.getElementById(`char-count-${pageNum}`);
  if (el) { el.className = "page-text"; el.textContent = text; }
  if (ch) ch.textContent = `${text.length} chars`;
}

function toggleCard(n) { document.getElementById(`page-card-${n}`)?.classList.toggle("collapsed"); }

async function loadThumbnail(pageNum) {
  try {
    const r = await fetch(`/thumbnail/${currentJobId}/${pageNum}`);
    const d = await r.json();
    const el = document.getElementById(`thumb-${pageNum}`);
    if (el && d.image) el.innerHTML = `<img src="data:image/png;base64,${d.image}" alt="Page ${pageNum}" />`;
  } catch (_) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeDomId(s)   { return s.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase(); }
function escapeHtml(s)  { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function escapeAttr(s)  { return (s||"").replace(/"/g,"&quot;"); }
