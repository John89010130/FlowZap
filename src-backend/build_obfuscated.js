const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = __dirname;
const destDir = process.argv[2];

if (!destDir) {
    console.error("Falta a pasta de destino.");
    process.exit(1);
}

const envPath = path.join(srcDir, '.env');
const envVars = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

// Construimos um bloquinho pra injetar no topo de todos os arquivos JS
let envInjection = `// --- Auto-injected secrets (obfuscated) ---\n`;
for (const key of Object.keys(envVars)) {
    // Escapa as chaves para string literal JS
    envInjection += `process.env['${key}'] = ${JSON.stringify(envVars[key])};\n`;
}

// Arquivos pra ofuscar
const filesToObfuscate = ['server.js', 'whatsapp_service.js', 'webhook_server.js'];

for (const file of filesToObfuscate) {
    const filePath = path.join(srcDir, file);
    let code = fs.readFileSync(filePath, 'utf8');

    // Remove as importações de dotenv original para não dar erro
    code = code.replace(/require\(['"]dotenv['"]\)\.config\(.*?\);?/g, '// dotenv removed');

    // Injeta nossas secrets reais direto no NodeJS no topo de tudo
    code = envInjection + '\n' + code;

    // Roda a ferramenta de obfuscação (Misturador de Código)
    const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.8,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.5,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.8,
        target: 'node',
        unicodeEscapeSequence: false
    });

    const outPath = path.join(destDir, file);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(outPath, obfuscationResult.getObfuscatedCode(), 'utf8');
    console.log(`✅ [OBFUSCATOR] ${file} camuflado com sucesso e copiado!`);
}
