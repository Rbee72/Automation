const fs = require('fs');

function formatMath(t) { return t; } // mock for debug

function classifyMastery(ruleExpr) {
    const clean = ruleExpr.replace(/\s+/g, ' ').trim();
    if (/\d+\s*<=?\s*Z\s*<=?\s*\d+/.test(clean)) return 'adequateMastery';
    if (/Z\s*=\s*\d+/.test(clean) && !/[<>]/.test(clean)) return 'highMastery';
    if (/Z\s*<=?\s*\d+/.test(clean)) return 'requiresSupport';
    if (/Z\s*>=?\s*\d+/.test(clean)) return 'highMastery';
    return 'requiresSupport';
}

function isMasteryRule(line) {
    return /(?:\d+\s*[<>]=?\s*)?Z\s*[=<>]=?\s*\d+/.test(line);
}

function isTargetedRule(line) {
    return /^[A-Z0-9]{2,6}\s*>=?\s*\d+(?:\s+and\s+Z\s*[><=]+\s*\d+)?/i.test(line);
}

function parseDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
    let currentLO = null;
    const LOs = [];
    let state = 'INIT';
    let currentQuestion = null;
    let currentMasteryRecord = null;
    let currentTargetedRecord = null;

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
            masteryRules: [],
            targeted: [],
            dcGuideMap: {}
        };
        state = 'INIT';
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const loMatch = line.match(/^(?:LO|Learning\s*Objective|पाठ|एकाइ)\s*(\d+|[०-९]+)/i);
        if (loMatch) {
            newLO('LO' + loMatch[1]);
            continue;
        }
        if (!currentLO) continue;
        if (/diagnostic\s+code/i.test(line)) {
            finaliseQuestion(); finaliseMastery(); finaliseTargeted();
            state = 'DC_GUIDE'; continue;
        }
        if (/diagnostic\s+feedback/i.test(line)) {
            finaliseQuestion(); finaliseMastery(); finaliseTargeted();
            state = 'FEEDBACK'; continue;
        }
        if (/^(chapter[-\s]?\d+|learning objective|section:|number of questions?)/i.test(line)) continue;

        if (state === 'INIT' || state === 'QUESTIONS') {
            const optionMatch = line.match(/^(?:([a-dA-Dकखगघ])[).]\s+)?(.*?)\s*\(\s*([A-Z0-9]{1,6})\s*\)$/);
            if (optionMatch) {
                state = 'QUESTIONS';
                if (!currentQuestion) {
                    currentQuestion = { questionN: currentLO.ce.length + 1, questionType: 'Multiple Choice', question: '', options: [] };
                }
                const code = optionMatch[3].toUpperCase();
                currentQuestion.options.push({
                    answer: optionMatch[2].trim(),
                    isCorrect: code === 'Z' ? 'y' : '',
                    diagnosticCode: code
                });
                continue;
            }
            if (currentQuestion && currentQuestion.options.length > 0) {
                finaliseQuestion();
            }
            const qStartMatch = line.match(/^(\d+|[०-९]+)[.)]\s+(.+)$/);
            if (qStartMatch) {
                state = 'QUESTIONS';
                const qTextRaw = qStartMatch[2];
                const inlineOptionSplit = qTextRaw.search(/\b[a-dक-घ]\s*\)/i);
                const questionText = (inlineOptionSplit > 0 ? qTextRaw.substring(0, inlineOptionSplit) : qTextRaw).trim();
                currentQuestion = {
                    questionN: currentLO.ce.length + 1,
                    questionType: 'Multiple Choice',
                    question: questionText,
                    options: []
                };
                continue;
            }
            if (/^(questions?|प्रश्नहरू)$/i.test(line)) continue;
            if (!currentQuestion) {
                state = 'QUESTIONS';
                currentQuestion = {
                    questionN: currentLO.ce.length + 1,
                    questionType: 'Multiple Choice',
                    question: line,
                    options: []
                };
            } else {
                currentQuestion.question += '\n' + line;
            }
        } else if (state === 'DC_GUIDE') {
            const dcMatch = line.match(/^([A-Z0-9]{1,6})\s*([=→:]|->|-)\s*(.+)$/i);
            if (dcMatch) {
                const code = dcMatch[1].toUpperCase();
                const desc = dcMatch[3].trim();
                currentLO.dcGuideMap[code] = desc;
            }
        } else if (state === 'FEEDBACK') {
            if (isTargetedRule(line)) {
                finaliseMastery(); state = 'TARGETED';
            } else if (isMasteryRule(line)) {
                finaliseMastery();
                const mrMatch = line.match(/^((?:\d+\s*[<>]=?\s*)?Z\s*[=<>]=?\s*\d+)(.*)$/);
                const ruleOnly = mrMatch ? mrMatch[1].trim() : line;
                let remarksText = mrMatch ? mrMatch[2].replace(/^[:\-\s]+/, '').trim() : '';
                currentMasteryRecord = {
                    rule: ruleOnly,
                    band: classifyMastery(ruleOnly),
                    lines: remarksText ? [remarksText] : []
                };
            } else if (currentMasteryRecord) {
                if (/^(complete|adequate|inadequate)\s+mastery$/i.test(line)) continue;
                if (/^targeted\s+feedbacks?/i.test(line)) continue;
                currentMasteryRecord.lines.push(line);
            }
        }
        
        if (state === 'TARGETED') {
            if (isTargetedRule(line)) {
                finaliseTargeted();
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

const text = fs.readFileSync('docs_debug.txt', 'utf8');
const LOs = parseDocument(text);

const exportedFiles = {};

for (const lo of LOs) {
    const loNum = lo.id.replace(/^LO/i, '');
    const filePrefix = `3_LO${loNum}_CE`;
    
    const ceRecords = [];
    for (const q of lo.ce) {
        let first = true;
        for (const opt of q.options) {
            ceRecords.push({
                questionN: first ? q.questionN : '',
                question: first ? q.question : '',
                answer: opt.answer
            });
            first = false;
        }
    }
    
    if (ceRecords.length > 0) {
        // Mocking the overwrite behavior
        exportedFiles[filePrefix] = ceRecords;
    }
}

Object.keys(exportedFiles).forEach(file => {
    console.log(`\nFile: ${file}`);
    const records = exportedFiles[file];
    const questionNumbers = records.filter(r => r.questionN !== '').map(r => r.questionN);
    console.log(`Total questions in Excel: ${questionNumbers.length}`);
    console.log(`Question Numbers: ${questionNumbers.join(', ')}`);
});
