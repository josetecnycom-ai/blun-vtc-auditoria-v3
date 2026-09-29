const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

let htmlTemplate = fs.readFileSync(path.join(srcDir, 'vtc-comparador.html'), 'utf8');

let cssContent = "";
const cssPath = path.join(srcDir, 'css', 'vtc-comparador.css');
if (fs.existsSync(cssPath)) {
    cssContent = fs.readFileSync(cssPath, 'utf8');
}

const jsFiles = [
    'data-manager.js',
    'rule-manager.js',
    'stop-analyzer.js',
    'passenger-camera.js',
    'risk-engine.js',
    'ui.js',
    'main.js'
];

let jsContent = "";
for (const file of jsFiles) {
    const jsPath = path.join(srcDir, 'js', file);
    if (fs.existsSync(jsPath)) {
        jsContent += `// --- ${file} ---\n`;
        jsContent += fs.readFileSync(jsPath, 'utf8') + '\n\n';
    }
}

htmlTemplate = htmlTemplate.replace('<!-- BUILD_INSERT_CSS -->', `<style>\n${cssContent}\n</style>`);
htmlTemplate = htmlTemplate.replace('<!-- BUILD_INSERT_JS -->', `<script>\n${jsContent}\n</script>`);

fs.writeFileSync(path.join(distDir, 'vtc-comparador.html'), htmlTemplate, 'utf8');

const svgPath = path.join(srcDir, 'vtc-icon.svg');
if (fs.existsSync(svgPath)) {
    fs.copyFileSync(svgPath, path.join(distDir, 'vtc-icon.svg'));
}

console.log('Compilación completada exitosamente en dist/vtc-comparador.html con Node.js');
