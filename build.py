import os
import shutil

# Rutas de origen y destino
SRC_DIR = 'src'
DIST_DIR = 'dist'

HTML_TEMPLATE = os.path.join(SRC_DIR, 'vtc-comparador.html')
CSS_FILE = os.path.join(SRC_DIR, 'css', 'vtc-comparador.css')
SVG_ICON = os.path.join(SRC_DIR, 'vtc-icon.svg')

# Orden estricto de dependencias
JS_FILES = [
    'data-manager.js',
    'rule-manager.js',
    'stop-analyzer.js',
    'risk-engine.js',
    'ui.js',
    'main.js'
]

def build():
    print("Iniciando compilación V3.0...")
    
    # Asegurar que existe el directorio dist
    if not os.path.exists(DIST_DIR):
        os.makedirs(DIST_DIR)
        
    # 1. Leer la plantilla HTML
    with open(HTML_TEMPLATE, 'r', encoding='utf-8') as f:
        html_content = f.read()
        
    # 2. Leer el archivo CSS
    css_content = ""
    if os.path.exists(CSS_FILE):
        with open(CSS_FILE, 'r', encoding='utf-8') as f:
            css_content = f.read()
            
    # 3. Concatenar los archivos JS en el orden correcto
    js_content = ""
    for js_file in JS_FILES:
        path = os.path.join(SRC_DIR, 'js', js_file)
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                js_content += f"// --- {js_file} ---\n"
                js_content += f.read() + "\n\n"
        else:
            print(f"ADVERTENCIA: No se encontró {path}")
            
    # 4. Reemplazar los marcadores en el HTML
    html_content = html_content.replace('<!-- BUILD_INSERT_CSS -->', f"<style>\n{css_content}\n</style>")
    html_content = html_content.replace('<!-- BUILD_INSERT_JS -->', f"<script>\n{js_content}\n</script>")
    
    # 5. Escribir el HTML final en dist
    out_html = os.path.join(DIST_DIR, 'vtc-comparador.html')
    with open(out_html, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f"HTML generado en {out_html}")
    
    # 6. Copiar el icono SVG a dist
    if os.path.exists(SVG_ICON):
        out_svg = os.path.join(DIST_DIR, 'vtc-icon.svg')
        shutil.copy2(SVG_ICON, out_svg)
        print(f"Icono copiado a {out_svg}")
        
    print("¡Compilación terminada con éxito!")

if __name__ == '__main__':
    build()
