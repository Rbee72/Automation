function formatMath(text, isDR = false) {
    if (!text || typeof text !== 'string') return text;

    // First replace symbols and escape {}
    let out = text;
    out = out.replace(/\{/g, '\\{').replace(/\}/g, '\\}');

    const replacements = {
        '!=': '\\neq', '≠': '\\neq',
        '<=': '\\leq', '≤': '\\leq',
        '>=': '\\geq', '≥': '\\geq',
        '==': '=',
        '×': '\\times',
        '÷': '\\div',
        '±': '\\pm',
        '->': '\\rightarrow', '→': '\\rightarrow',
        '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', 
        '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
        '⁺': '^{+}', '⁻': '^{-}', '⁼': '^{=}', '⁽': '^{(}', '⁾': '^{)}',
        '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4', 
        '₅': '_5', '₆': '_6', '₇': '_7', '₈': '_8', '₉': '_9',
        '₊': '_{+}', '₋': '_{-}', '₌': '_{=}', '₍': '_{(}', '₎': '_{)}'
    };
    for (const [k, v] of Object.entries(replacements)) {
        out = out.split(k).join(v);
    }

    // Mathematical blocks include numbers (with optional commas/dots), single letters, and operators.
    const textWords = /^(is|a|an|the|of|and|or|but|in|on|at|by|for|as|less|than|multiple|represented|form|which|what|where|how|find|solve|evaluate|odd|even|numbers|number|set)$/i;

    const tokens = out.match(/([a-zA-Z]+|\d+([,.]\d+)*|\\\{|\\\}|\\neq|\\leq|\\geq|\\times|\\div|\\pm|\\rightarrow|\^|\_|[^a-zA-Z\d\s]|\s+)/g) || [];

    let result = '';
    let inMath = false;
    let mathStr = '';

    const isMathToken = (t) => {
        if (!t.trim()) return false; 
        if (/^[?,.!;:'"()[\]{}\u0964'‘’"“”]+$/.test(t)) return false; // Punctuation including brackets and quotes
        
        if (t === '-' || t === '—' || t === '–') {
            return true; // Decided by context in loop
        }

        if (/^[a-zA-Z]{2,}$/.test(t) && !/^(sin|cos|tan|log|ln|^{.*}|_{.*})$/i.test(t)) return false; 
        if (textWords.test(t)) return false; 
        return true; 
    };

    let insideSet = false; // keep track of \{ \} context to keep commas inside math

    for (let i = 0; i < tokens.length; i++) {
        let t = tokens[i];
        let isMath = isMathToken(t);

        if (t === '-' || t === '—' || t === '–') {
            let prev = i > 0 ? tokens[i-1] : '';
            let next = i < tokens.length - 1 ? tokens[i+1] : '';
            if (/^[a-zA-Z]+$/.test(prev) && /^[a-zA-Z]+$/.test(next)) isMath = false; // "non-terminating"
            else {
                let prevNonSpace = null, nextNonSpace = null;
                for(let j=i-1; j>=0; j--) { if(tokens[j].trim()) { prevNonSpace = tokens[j]; break; } }
                for(let j=i+1; j<tokens.length; j++) { if(tokens[j].trim()) { nextNonSpace = tokens[j]; break; } }
                if (prevNonSpace && nextNonSpace) {
                    if (/^[a-zA-Z]{2,}$/.test(prevNonSpace) || /^[a-zA-Z]{2,}$/.test(nextNonSpace)) {
                        isMath = false; // "Chapter 3 - Multimedia"
                    }
                }
            }
        }

        // Skip colon in DR mode per user request
        if (isDR && t === ':') isMath = false;

        if (t === '\\{') insideSet = true;
        if (t === '\\}') insideSet = false;

        // Commas inside a set are math
        if (insideSet && t === ',') isMath = true;

        // If it's a single letter like 'A' next to an operator, it's math
        if (t === 'A' || t === 'I') {
            let nextIsMath = false;
            for(let j=i+1; j<tokens.length; j++) {
                if (!tokens[j].trim()) continue;
                if (/^[=<>+\-*/:]|\\/.test(tokens[j])) nextIsMath = true;
                break;
            }
            if (nextIsMath) isMath = true;
            else if (!insideSet) isMath = false; // avoid English A if not in math context
        }

        if (isMath) {
            inMath = true;
            mathStr += t;
        } else if (!t.trim() && inMath) {
            // Space inside math block
            let nextIsMath = false;
            for(let j=i+1; j<tokens.length; j++) {
                if (!tokens[j].trim()) continue;
                nextIsMath = isMathToken(tokens[j]);
                if (insideSet && tokens[j] === ',') nextIsMath = true;
                break;
            }
            if (nextIsMath) {
                mathStr += t;
            } else {
                inMath = false;
                result += '{{' + mathStr.trim() + '}}' + (mathStr.match(/\s+$/) ? ' ' : '') + t;
                mathStr = '';
            }
        } else {
            if (inMath) {
                inMath = false;
                result += '{{' + mathStr.trim() + '}}' + (mathStr.match(/\s+$/) ? ' ' : '') + t;
                mathStr = '';
            } else {
                result += t;
            }
        }
    }

    if (inMath) {
        result += '{{' + mathStr.trim() + '}}' + (mathStr.match(/\s+$/) ? ' ' : '');
    }

    // Fix missing spaces before and after {{ }} rules mentioned by user
    // Only add space if previous char is NOT an opening bracket/quote
    result = result.replace(/([^ \n\r\(\{\['"])\{\{/g, '$1 {{');
    // Only add space if next char is NOT a closing bracket/punctuation
    result = result.replace(/\}\}([^ \n\r\.\,\?\!\:\;\)\}\]'"])/g, '}} $1');

    return result;
}

module.exports = { formatMath };
