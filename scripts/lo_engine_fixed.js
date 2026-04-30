const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const chokidar = require('chokidar');
const XLSX = require('xlsx');

const WATCH_DIR = path.resolve('/home/rajat/Automation/In Book Quiz');
const EXPORT_DIR = path.resolve('/home/rajat/Automation/LO_Ingestion_Engine/exports');

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

console.log(`Watching for .docx files in: ${WATCH_DIR}`);

const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    usePolling: true,
    interval: 1000,
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
    }
});

const CACHE_FILE = path.resolve('/home/rajat/Automation/LO_Ingestion_Engine/processed_cache.json');
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

watcher.on('add', processFile).on('change', processFile);

async function processFile(filePath) {
    if (!filePath.endsWith('.docx') || path.basename(filePath).startsWith('~$')) return;

    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs.toString();

    if (cache[filePath] === mtime) return;

    console.log(`\nProcessing file: ${filePath}`);
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value;
        const parsedData = parseDocument(text);

        await exportData(filePath, parsedData);

        cache[filePath] = mtime;
        saveCache();

        console.log(`Successfully exported data for ${path.basename(filePath)}`);
    } catch (err) {
        console.error(`Error processing file ${filePath}:`, err);
    }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Determine mastery band from a rule expression string.
 * Rules look like:  "Z = 10"  |  "5 <= Z <= 9"  |  "Z <= 4"  |  "Z < 5"
 * We classify:
 *   highMastery      – rule contains "Z = N" (exact) or "Z >= N" (where N equals total)
 *   adequateMastery  – rule contains both a lower and upper bound (middle band)
 *   requiresSupport  – rule contains "Z <= N" or "Z < N" (only upper bound, low end)
 */
function classifyMastery(ruleExpr) {
    const clean = ruleExpr.replace(/\s+/g, ' ').trim();

    // Middle band:  "5 <= Z <= 9"  or  "5 < Z < 9"
    if (/\d+\s*<=?\s*Z\s*<=?\s*\d+/.test(clean)) return 'adequateMastery';

    // Exact / high:  "Z = 10"
    if (/Z\s*=\s*\d+/.test(clean) && !/[<>]/.test(clean)) return 'highMastery';

    // Low end:  "Z <= 4"  or  "Z < 5"
    if (/Z\s*<=?\s*\d+/.test(clean)) return 'requiresSupport';

    // Fallback – if there's only a lower bound "Z >= N", treat as high
    if (/Z\s*>=?\s*\d+/.test(clean)) return 'highMastery';

    return 'requiresSupport';
}

/**
 * Returns true if a line looks like a mastery threshold expression.
 * Examples:  "Z = 10"  |  "Z <= 4"  |  "5 <= Z <= 9"
 */
function isMasteryRule(line) {
    return /(?:\d+\s*[<>]=?\s*)?Z\s*[=<>]=?\s*\d+/.test(line);
}

/**
 * Returns true if a line looks like a targeted feedback rule.
 * Examples:  "OFD >= 1 and Z > 4"  |  "MPF >= 1 and Z > 5"
 */
function isTargetedRule(line) {
    return /^[A-Z]{2,5}\s*>=?\s*\d+\s+and\s+Z\s*[><=]+\s*\d+/i.test(line);
}

// ─── PARSER ─────────────────────────────────────────────────────────────────

function parseDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');

    let currentLO = null;
    const LOs = [];

    // States: INIT | QUESTIONS | FEEDBACK | TARGETED
    let state = 'INIT';

    let currentQuestion = null;

    // For mastery accumulation
    let currentMasteryRecord = null;   // { rule, band, lines[] }

    // For targeted feedback accumulation
    let currentTargetedRecord = null;  // { rule, code, lines[] }

    function finaliseQuestion() {
        if (currentQuestion && currentLO) {
            currentLO.ce.push(currentQuestion);
            currentQuestion = null;
        }
    }

    function finaliseMastery() {
        if (currentMasteryRecord && currentLO) {
            currentLO.masteryRules.push({
                band: currentMasteryRecord.band,
                rule: currentMasteryRecord.rule,
                remarks: currentMasteryRecord.lines.join('\n').trim()
            });
            currentMasteryRecord = null;
        }
    }

    function finaliseTargeted() {
        if (currentTargetedRecord && currentLO) {
            currentLO.targeted.push({
                rule: currentTargetedRecord.rule,
                code: currentTargetedRecord.code,
                remarks: currentTargetedRecord.lines.join('\n').trim()
            });
            currentTargetedRecord = null;
        }
    }

    function finaliseLO() {
        finaliseQuestion();
        finaliseMastery();
        finaliseTargeted();
        if (currentLO) {
            LOs.push(currentLO);
            currentLO = null;
        }
    }

    function newLO(id) {
        finaliseLO();
        currentLO = {
            id,
            ce: [],
            masteryRules: [],   // [{ band, rule, remarks }]
            targeted: []        // [{ rule, code, remarks }]
        };
        state = 'INIT';
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // ── Detect new LO header ────────────────────────────────────────────
        const loMatch = line.match(/^(?:LO|पाठ|एकाइ)\s*(\d+)/i);
        if (loMatch) {
            newLO('LO' + loMatch[1]);
            continue;
        }

        if (!currentLO) continue;

        // ── Detect section transitions ──────────────────────────────────────

        // "Diagnostic feedback" heading (case-insensitive, anywhere in line)
        if (/diagnostic\s+feedback/i.test(line)) {
            finaliseQuestion();
            state = 'FEEDBACK';
            continue;
        }

        // Skip metadata lines in any state
        if (/^(chapter[-\s]?\d+|learning objective|section:|number of questions?)/i.test(line)) continue;

        // ── State: INIT / QUESTIONS ─────────────────────────────────────────
        if (state === 'INIT' || state === 'QUESTIONS') {

            // Numbered question start:  "1. What is..."  or  "1) What is..."
            const qStartMatch = line.match(/^(\d+|[०-९]+)[.)]\s+(.+)$/);
            if (qStartMatch) {
                finaliseQuestion();
                state = 'QUESTIONS';

                // Strip any inline option text that may be on the same line as the question
                // (rare but possible). Split on first option pattern.
                const qTextRaw = qStartMatch[2];
                const inlineOptionSplit = qTextRaw.search(/\ba\s*\)/i);
                const questionText = (inlineOptionSplit > 0
                    ? qTextRaw.substring(0, inlineOptionSplit)
                    : qTextRaw).trim();

                currentQuestion = {
                    questionN: currentLO.ce.length + 1,
                    questionType: 'Multiple Choice',
                    question: questionText,
                    options: []
                };
                continue;
            }

            if (state === 'QUESTIONS' && currentQuestion) {
                // Option line:  "a) Some text (CODE)"  or  "a) Some text (Z)"
                // Handles both English a/b/c/d and Nepali क/ख/ग/घ
                const optionMatch = line.match(/^([a-dA-Dकखगघ])[).]\s+(.*?)\s*\(\s*([A-Z]{1,5})\s*\)$/);
                if (optionMatch) {
                    const code = optionMatch[3].toUpperCase();
                    currentQuestion.options.push({
                        answer: optionMatch[2].trim(),
                        isCorrect: code === 'Z' ? 'y' : '',
                        diagnosticCode: code  // store raw; export logic handles Z vs others
                    });
                    continue;
                }

                // Multi-line question continuation (no option pattern, no number start)
                if (currentQuestion.options.length === 0) {
                    currentQuestion.question += ' ' + line;
                }
            }
        }

        // ── State: FEEDBACK (mastery bands) ────────────────────────────────
        else if (state === 'FEEDBACK') {

            // Transition to targeted rules when we see the first targeted rule line
            if (isTargetedRule(line)) {
                finaliseMastery();
                state = 'TARGETED';
                // Fall through to TARGETED handler below
            } else if (isMasteryRule(line)) {
                // New mastery band starts
                finaliseMastery();
                currentMasteryRecord = {
                    rule: line,
                    band: classifyMastery(line),
                    lines: []
                };
                continue;
            } else if (currentMasteryRecord) {
                // Skip the band label lines ("Complete mastery", "Adequate mastery", etc.)
                // and section sub-headers ("Further learning", "Recommended action plan")
                // but keep all body text.
                if (/^(complete|adequate|inadequate)\s+mastery$/i.test(line)) continue;
                currentMasteryRecord.lines.push(line);
                continue;
            } else {
                continue; // content before first rule — skip
            }
        }

        // ── State: TARGETED (targeted feedback rules) ───────────────────────
        if (state === 'TARGETED') {
            if (isTargetedRule(line)) {
                finaliseTargeted();
                const codeMatch = line.match(/^([A-Z]{2,5})/i);
                currentTargetedRecord = {
                    rule: line,
                    code: codeMatch ? codeMatch[1].toUpperCase() : 'UNK',
                    lines: []
                };
            } else if (currentTargetedRecord) {
                currentTargetedRecord.lines.push(line);
            }
        }
    }

    finaliseLO();
    return LOs;
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

async function exportData(filePath, LOs) {
    const baseName = path.basename(filePath, '.docx');

    const baseWatchDir = path.resolve(WATCH_DIR);
    const absoluteFilePath = path.resolve(filePath);
    let relativePath = absoluteFilePath.replace(baseWatchDir, '');
    if (relativePath.startsWith(path.sep)) relativePath = relativePath.substring(1);

    const topLevelFolder = relativePath.split(path.sep)[0];
    const targetExportDir = (topLevelFolder && topLevelFolder !== baseName + '.docx')
        ? path.join(EXPORT_DIR, topLevelFolder)
        : EXPORT_DIR;

    if (!fs.existsSync(targetExportDir)) {
        fs.mkdirSync(targetExportDir, { recursive: true });
    }

    // Derive file prefix from folder name, e.g. "Grade 8 Accounts" → "Acc8"
    // Falls back to baseName_LON
    const folderMatch = topLevelFolder ? topLevelFolder.match(/Chapter\s*(\d+)/i) : null;

    for (const lo of LOs) {
        const loNum = lo.id.replace(/^LO/i, '');
        const filePrefix = folderMatch
            ? `${folderMatch[1]}_LO${loNum}`
            : `${baseName}_LO${loNum}`;

        // ── CE ──────────────────────────────────────────────────────────────
        const ceRecords = [];
        for (const q of lo.ce) {
            let first = true;
            for (const opt of q.options) {
                ceRecords.push({
                    questionN:      first ? q.questionN    : '',
                    questionType:   first ? q.questionType : '',
                    question:       first ? q.question     : '',
                    QIMG:           '',
                    isCorrect:      opt.isCorrect,
                    answer:         opt.answer,
                    AIMG:           '',
                    marks:          first ? 1 : '',
                    diagnosticCode: opt.diagnosticCode === 'Z' ? 'Z' : opt.diagnosticCode
                });
                first = false;
            }
        }

        // ── DC ──────────────────────────────────────────────────────────────
        // Derive DC entries from the targeted rules (no separate guide section in these docs)
        const dcRecords = [{ code: 'Z', codeRemarks: 'Correct answers', correctAnswer: 'y' }];
        const seenCodes = new Set(['Z']);
        for (const t of lo.targeted) {
            if (!seenCodes.has(t.code)) {
                seenCodes.add(t.code);
                dcRecords.push({
                    code:         t.code,
                    codeRemarks:  t.remarks,
                    correctAnswer: ''
                });
            }
        }

        // ── DR remarks ──────────────────────────────────────────────────────
        const drRemarksRecords = lo.targeted.map(t => ({
            rule:        t.rule,
            ruleRemarks: t.remarks
        }));

        // ── DR masteryRule ───────────────────────────────────────────────────
        // Must always produce exactly 3 rows in order: highMastery, adequateMastery, requiresSupport
        const masteryMap = {};
        for (const m of lo.masteryRules) {
            masteryMap[m.band] = m;
        }

        const drMasteryRecords = [
            {
                mastery: 'highMastery',
                code:    masteryMap.highMastery    ? masteryMap.highMastery.rule    : '',
                remarks: masteryMap.highMastery    ? masteryMap.highMastery.remarks : ''
            },
            {
                mastery: 'adequateMastery',
                code:    '',  // always blank per spec
                remarks: masteryMap.adequateMastery ? masteryMap.adequateMastery.remarks : ''
            },
            {
                mastery: 'requiresSupport',
                code:    masteryMap.requiresSupport ? masteryMap.requiresSupport.rule    : '',
                remarks: masteryMap.requiresSupport ? masteryMap.requiresSupport.remarks : ''
            }
        ];

        // ── Write files ──────────────────────────────────────────────────────
        if (ceRecords.length > 0) {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(ceRecords, {
                header: ['questionN','questionType','question','QIMG','isCorrect','answer','AIMG','marks','diagnosticCode']
            });
            XLSX.utils.book_append_sheet(wb, ws, 'Questions');
            XLSX.writeFile(wb, path.join(targetExportDir, `${filePrefix}_CE.xlsx`));
        }

        if (dcRecords.length > 1) {  // more than just Z row
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(dcRecords, {
                header: ['code','codeRemarks','correctAnswer']
            });
            XLSX.utils.book_append_sheet(wb, ws, 'diagnosticCodes');
            XLSX.writeFile(wb, path.join(targetExportDir, `${filePrefix}_DC.xlsx`));
        }

        if (drRemarksRecords.length > 0 || drMasteryRecords.some(r => r.remarks)) {
            const wb = XLSX.utils.book_new();
            if (drRemarksRecords.length > 0) {
                const ws = XLSX.utils.json_to_sheet(drRemarksRecords, {
                    header: ['rule','ruleRemarks']
                });
                XLSX.utils.book_append_sheet(wb, ws, 'remarks');
            }
            if (drMasteryRecords.some(r => r.remarks)) {
                const ws = XLSX.utils.json_to_sheet(drMasteryRecords, {
                    header: ['mastery','code','remarks']
                });
                XLSX.utils.book_append_sheet(wb, ws, 'masteryRule');
            }
            XLSX.writeFile(wb, path.join(targetExportDir, `${filePrefix}_DR.xlsx`));
        }

        console.log(`  → Exported: ${filePrefix}_CE/DC/DR.xlsx`);
    }
}
