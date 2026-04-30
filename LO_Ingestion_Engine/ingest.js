const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const chokidar = require('chokidar');
const XLSX = require('xlsx');
const { formatMath } = require('./mathWrapper');

const WATCH_DIR = path.resolve('/home/rajat/Automation/In Book Quiz/Working_Input');
const EXPORT_DIR = path.resolve('/home/rajat/Automation/In Book Quiz/Working_Exports');

if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
}

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

console.log(`v1.5.0 - Watching for .docx files in: ${WATCH_DIR}`);

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

watcher
    .on('add', (p) => { console.log(`[WATCHER] Detected new file: ${p}`); processFile(p); })
    .on('change', (p) => { console.log(`[WATCHER] Detected changed file: ${p}`); processFile(p); })
    .on('ready', () => console.log('[WATCHER] Initial scan complete. Ready for changes.'));

async function processFile(filePath) {
    console.log(`[PROCESS] Checking file: ${path.basename(filePath)}`);
    if (!filePath.endsWith('.docx') || path.basename(filePath).startsWith('~$')) {
        console.log(`[PROCESS] Skipping (not a docx or temp file): ${filePath}`);
        return;
    }

    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs.toString();

    if (cache[filePath] === mtime) {
        console.log(`[PROCESS] Skipping (already in cache): ${path.basename(filePath)}`);
        return;
    }

    console.log(`[PROCESS] Starting ingestion for: ${path.basename(filePath)}...`);

    console.log(`\nProcessing file: ${filePath}`);
    try {
        const fileName = filePath.split(/[\\\/]/).pop();
        const rawHtml = await mammoth.convertToHtml({ path: filePath });
        
        // Only wrap math for files that are likely Math subjects
        const isMath = /math/i.test(fileName);
        console.log(`[PROCESS] File: ${fileName} | isMath: ${isMath}`);
        let html = isMath ? formatMath(rawHtml.value) : rawHtml.value;
        html = html.replace(/<sup>(.*?)<\/sup>/gi, '^{$1}');
        html = html.replace(/<sub>(.*?)<\/sub>/gi, '_{$1}');
        html = html.replace(/<\/?(p|h[1-6]|li|div|tr|table|ul|ol)[^>]*>/gi, '\n');
        html = html.replace(/<[^>]+>/g, '');
        html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        html = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

        const parsedData = parseDocument(html);

        if (parsedData.length === 0) {
            console.log(`⚠️  Warning: No LOs/पाठ/एकाइ found in ${path.basename(filePath)}. Check if formatting exactly matches 'एकाइ 1' etc.`);
        } else {
            await exportData(filePath, parsedData, isMath);
            console.log(`Successfully exported data for ${path.basename(filePath)}`);
        }

        cache[filePath] = mtime;
        saveCache();
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
    return /^[A-Z0-9]{2,6}\s*>=?\s*\d+(?:\s+and\s+Z\s*[><=]+\s*\d+)?/i.test(line);
}

// ─── PARSER ─────────────────────────────────────────────────────────────────

function parseDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');

    let currentLO = null;
    const LOs = [];

    // States: INIT | QUESTIONS | DC_GUIDE | FEEDBACK | TARGETED
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

    function extractOptionsFromLine(line) {
        const results = [];
        // 1) Case for lettered options: a) text (CODE) - can be multiple per line
        const letteredOptRegex = /([a-dA-Dकखगघ])[).]\s*(.*?)\s*\(\s*([A-Z0-9]{1,6})\s*\)/g;
        
        // 2) Case for unlettered options: text (CODE) - must be the whole line and end with the code
        const unletteredOptRegex = /^(.+?)\s*\(\s*([A-Z0-9]{1,6})\s*\)$/;

        let match;
        let firstMatchIndex = -1;

        // Check if the line looks like it contains lettered options (a) or a. at start or after space)
        if (line.match(/^[a-dA-Dकखगघ][).]/) || line.match(/\s[a-dA-Dकखगघ][).]/)) {
            while ((match = letteredOptRegex.exec(line)) !== null) {
                if (firstMatchIndex === -1) firstMatchIndex = match.index;
                results.push({
                    letter: match[1],
                    text: match[2].trim(),
                    code: match[3].toUpperCase(),
                    index: match.index
                });
            }
        } else {
            match = line.match(unletteredOptRegex);
            if (match) {
                firstMatchIndex = 0;
                results.push({
                    letter: '',
                    text: match[1].trim(),
                    code: match[2].toUpperCase(),
                    index: 0
                });
            }
        }
        
        let questionPart = line;
        if (firstMatchIndex !== -1) {
            questionPart = line.substring(0, firstMatchIndex).trim();
        }
        
        return { questionPart, options: results };
    }

    function newLO(id) {
        finaliseLO();
        currentLO = {
            id,
            ce: [],
            masteryRules: [],   // [{ band, rule, remarks }]
            targeted: [],       // [{ rule, code, remarks }]
            dcGuideMap: {}      // { CODE: "Description" }
        };
        state = 'INIT';
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // ── Detect new LO header ────────────────────────────────────────────
        const loMatch = line.match(/^(?:LO|Learning\s*Objective|पाठ|एकाइ)\s*(\d+|[०-९]+)/i);
        if (loMatch) {
            newLO('LO' + loMatch[1]);
            continue;
        }

        if (!currentLO) continue;

        // ── Detect section transitions ──────────────────────────────────────

        // "Diagnostic code" heading 
        if (/diagnostic\s+code/i.test(line)) {
            finaliseQuestion();
            finaliseMastery();
            finaliseTargeted();
            state = 'DC_GUIDE';
            continue;
        }

        // "Diagnostic feedback" heading
        if (/diagnostic\s+feedback/i.test(line)) {
            finaliseQuestion();
            finaliseMastery();
            finaliseTargeted();
            state = 'FEEDBACK';
            continue;
        }

        // "Questions" heading - reset state to allow questions after DC/Feedback if they exist
        if (/^(questions?|प्रश्नहरू)$/i.test(line)) {
            finaliseQuestion();
            finaliseMastery();
            finaliseTargeted();
            state = 'QUESTIONS';
            continue;
        }

        // Skip metadata lines in any state
        if (/^(chapter[-\s]?\d+|learning objective|section:|number of questions?)/i.test(line)) continue;

        // ── State: INIT / QUESTIONS ─────────────────────────────────────────
        if (state === 'INIT' || state === 'QUESTIONS') {

            // 1) Is it an option?
            const { questionPart, options } = extractOptionsFromLine(line);
            
            if (options.length > 0) {
                state = 'QUESTIONS';
                if (!currentQuestion) {
                    currentQuestion = { questionN: currentLO.ce.length + 1, questionType: 'Multiple Choice', question: '', options: [] };
                }
                
                // If there was some text before the first option on this line, it might be the question text
                if (questionPart && options[0].index > 0) {
                     currentQuestion.question += (currentQuestion.question ? '\n' : '') + questionPart;
                }

                options.forEach(o => {
                    currentQuestion.options.push({
                        answer: o.text,
                        isCorrect: o.code === 'Z' ? 'y' : '',
                        diagnosticCode: o.code
                    });
                });
                continue;
            }

            // 2) Check if it's an explicitly numbered question
            const qStartMatch = line.match(/^(\d+|[०-९]+)[.)]\s+(.+)$/);
            if (qStartMatch) {
                if (currentQuestion && currentQuestion.options.length > 0) {
                    finaliseQuestion();
                }
                state = 'QUESTIONS';
                const qTextRaw = qStartMatch[2];
                
                const { questionPart, options: inlineOpts } = extractOptionsFromLine(qTextRaw);
                
                currentQuestion = {
                    questionN: currentLO.ce.length + 1,
                    questionType: 'Multiple Choice',
                    question: questionPart,
                    options: inlineOpts.map(o => ({
                        answer: o.text,
                        isCorrect: o.code === 'Z' ? 'y' : '',
                        diagnosticCode: o.code
                    }))
                };
                continue;
            }

            // 3) If it's not an option or numbered question, check if we should finalise
            if (currentQuestion && currentQuestion.options.length > 0) {
                // Signal to finalise: metadata line, numbered question, or a line ending with ? or :
                // Also finalise if we see a section header (handled at top of loop)
                if (line.match(/^(\d+|[०-९]+)[.)]/) || line.endsWith('?') || line.endsWith(':') || line.endsWith('।') || /^(chapter|section|learning objective|number of questions?)/i.test(line)) {
                    finaliseQuestion();
                }
            }

            // Ignore section headers commonly found here
            if (/^(questions?|प्रश्नहरू)$/i.test(line)) continue;

            // 4) Unnumbered question text or continuation!
            state = 'QUESTIONS';
            if (!currentQuestion) {
                currentQuestion = {
                    questionN: currentLO.ce.length + 1,
                    questionType: 'Multiple Choice',
                    question: line,
                    options: []
                };
            } else {
                // Continuation of an existing question
                currentQuestion.question += '\n' + line;
            }
        }

        // ── State: DC_GUIDE ─────────────────────────────────────────────────
        else if (state === 'DC_GUIDE') {
            const dcMatch = line.match(/^([A-Z0-9]{1,6})\s*([=→:]|->|-)\s*(.+)$/i);
            if (dcMatch) {
                const code = dcMatch[1].toUpperCase();
                const desc = dcMatch[3].trim(); // It is index 3 because match[2] is the separator
                currentLO.dcGuideMap[code] = desc;
            }
            continue;
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
                const mrMatch = line.match(/^((?:\d+\s*[<>]=?\s*)?Z\s*[=<>]=?\s*\d+)(.*)$/);
                const ruleOnly = mrMatch ? mrMatch[1].trim() : line;
                let remarksText = mrMatch ? mrMatch[2].replace(/^[:\-\s]+/, '').trim() : '';

                // Often there is a label like "Complete mastery" on the same line, let's omit it
                const cleanRemarks = remarksText.replace(/^(complete|adequate|inadequate)\s+mastery\s*[:\-]\s*/i, '');
                currentMasteryRecord = {
                    rule: ruleOnly,
                    band: classifyMastery(ruleOnly),
                    lines: cleanRemarks ? [cleanRemarks] : []
                };
                continue;
            } else if (currentMasteryRecord) {
                // Skip the band label lines and targeted headers
                if (/^(complete|adequate|inadequate)\s+mastery$/i.test(line)) continue;
                if (/^targeted\s+feedbacks?/i.test(line)) continue;
                
                const cleanLine = line.replace(/^(complete|adequate|inadequate)\s+mastery\s*[:\-]\s*/i, '');
                currentMasteryRecord.lines.push(cleanLine);
                continue;
            } else {
                continue; // content before first rule — skip
            }
        }

        // ── State: TARGETED (targeted feedback rules) ───────────────────────
        if (state === 'TARGETED') {
            if (isTargetedRule(line)) {
                finaliseTargeted();
                // Separate the rule from the remarks text
                const trMatch = line.match(/^([A-Z0-9]{2,6}\s*>=?\s*\d+(?:\s+and\s+Z\s*[><=]+\s*\d+)?)(.*)$/i);
                const ruleOnly = trMatch ? trMatch[1].trim() : line;
                let remarksText = trMatch ? trMatch[2].replace(/^[:\-\s]+/, '').trim() : '';
                
                const codeMatch = line.match(/^([A-Z0-9]{2,6})/i);
                currentTargetedRecord = {
                    rule: ruleOnly,
                    code: codeMatch ? codeMatch[1].toUpperCase() : 'UNK',
                    lines: remarksText ? [remarksText] : []
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

async function exportData(filePath, LOs, isMath = false) {
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

    // Group LOs by ID to handle duplicate headers/continued sections
    const mergedLOs = new Map();
    for (const lo of LOs) {
        if (!mergedLOs.has(lo.id)) {
            mergedLOs.set(lo.id, JSON.parse(JSON.stringify(lo)));
        } else {
            const existing = mergedLOs.get(lo.id);
            // Append questions and rules
            existing.ce = existing.ce.concat(lo.ce);
            existing.masteryRules = existing.masteryRules.concat(lo.masteryRules);
            existing.targeted = existing.targeted.concat(lo.targeted);
            // Merge guide map
            Object.assign(existing.dcGuideMap, lo.dcGuideMap);
        }
    }

    for (const [id, lo] of mergedLOs.entries()) {
        const loNum = id.replace(/^LO/i, '');
        const filePrefix = folderMatch
            ? `${folderMatch[1]}_LO${loNum}`
            : `${baseName}_LO${loNum}`;

        // Filter out questions with NO options (usually title blocks misidentified)
        const validQuestions = lo.ce.filter(q => q.options.length > 0);

        // ── CE ──────────────────────────────────────────────────────────────
        const ceRecords = [];
        let qCounter = 1;
        for (const q of validQuestions) {
            let first = true;
            for (const opt of q.options) {
                ceRecords.push({
                    questionN:      first ? qCounter : '',
                    questionType:   first ? q.questionType : '',
                    question:       first ? (isMath ? formatMath(q.question) : q.question) : '',
                    QIMG:           '',
                    isCorrect:      opt.isCorrect,
                    answer:         isMath ? formatMath(opt.answer) : opt.answer,
                    AIMG:           '',
                    marks:          first ? 1 : '',
                    diagnosticCode: opt.diagnosticCode === 'Z' ? 'Z' : opt.diagnosticCode
                });
                first = false;
            }
            qCounter++;
        }

        // ── DC ──────────────────────────────────────────────────────────────
        const dcRecords = [{ code: 'Z', codeRemarks: lo.dcGuideMap['Z'] || 'Correct answers', correctAnswer: 'y' }];
        
        // Collect all unique diagnostic codes (excluding Z)
        const allCodes = new Set(Object.keys(lo.dcGuideMap));
        for (const t of lo.targeted) allCodes.add(t.code);
        allCodes.delete('Z');

        for (const code of Array.from(allCodes)) {
             dcRecords.push({
                 code:         code,
                 codeRemarks:  lo.dcGuideMap[code] || '-',
                 correctAnswer: ''
             });
        }

        // ── DR remarks ──────────────────────────────────────────────────────
        const drRemarksRecords = lo.targeted.map(t => ({
            rule:        t.rule,
            ruleRemarks: isMath ? formatMath(t.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : t.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()
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
                remarks: masteryMap.highMastery    ? (isMath ? formatMath(masteryMap.highMastery.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : masteryMap.highMastery.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : ''
            },
            {
                mastery: 'adequateMastery',
                code:    '',  // always blank per spec
                remarks: masteryMap.adequateMastery ? (isMath ? formatMath(masteryMap.adequateMastery.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : masteryMap.adequateMastery.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : ''
            },
            {
                mastery: 'requiresSupport',
                code:    masteryMap.requiresSupport ? masteryMap.requiresSupport.rule    : '',
                remarks: masteryMap.requiresSupport ? (isMath ? formatMath(masteryMap.requiresSupport.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : masteryMap.requiresSupport.remarks.replace(/^[•\-\*\u2022\u25E6\u2023]\s*/gm, '').replace(/[🚨⚠]/g, '').trim()) : ''
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
