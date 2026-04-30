const fs = require('fs');
const mammoth = require('mammoth');

async function extractText(filePath) {
    try {
        const result = await mammoth.extractRawText({path: filePath});
        console.log(result.value.substring(0, 5000));
        fs.writeFileSync('out.txt', result.value);
    } catch (e) {
        console.error(e);
    }
}
extractText('\\\\wsl.localhost\\Ubuntu-24.04\\home\\rajat\\Automation\\In Book Quiz\\sample doc for Chapter 1\\Chapter 1 - Network.docx');
