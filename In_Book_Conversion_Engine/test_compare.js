const fs = require('fs');

function formatMath(t) { return t; } // mock

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
            const qStartMatch = line.match(/^(\d+|[०-९]+)[.)]\s+(.+)$/);
            if (qStartMatch) {
                if (currentQuestion && currentQuestion.options.length > 0) { finaliseQuestion(); }
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
            if (currentQuestion && currentQuestion.options.length > 0) { finaliseQuestion(); }
            if (/^(questions?|प्रश्नहरू)$/i.test(line)) continue;
            if (!currentQuestion) {
                state = 'QUESTIONS';
                currentQuestion = { questionN: currentLO.ce.length + 1, questionType: 'Multiple Choice', question: line, options: [] };
            } else { currentQuestion.question += '\n' + line; }
        } else if (state === 'DC_GUIDE') {
            // ... dc guide logic
        } else if (state === 'FEEDBACK') {
            // ... feedback logic
        }
    }
    finaliseLO();
    return LOs;
}

const text = fs.readFileSync('docs_debug.txt', 'utf8');
const result = parseDocument(text);

const lo1 = result.find(l => l.id === 'LO1' && l.ce.filter(q => q.options.length > 0).length > 0);
const lo3 = result.find(l => l.id === 'LO3' && l.ce.filter(q => q.options.length > 0).length > 0);

console.log('LO1 questions:', lo1.ce.filter(q => q.options.length > 0).length);
console.log('LO3 questions:', lo3.ce.filter(q => q.options.length > 0).length);
