#!/usr/bin/env python3
"""Prepara la carpeta data/ del repositorio a partir de la copia local de ArcGIS Corpocaldas.

Uso (desde la raíz del repositorio clonado, en Windows):
    python herramientas/preparar_datos.py "G:\\Mi unidad\\I+D\\ArcGIS_Corpocaldas_Completo\\_raiz"

Qué hace:
  * Lee data/catalogo.json.
  * Para cada capa con estado "local" toma el GeoJSON de origen, redondea las coordenadas
    a 5 decimales (~1 m), lo guarda minificado en la ruta "archivo" del catálogo.
  * Las capas "en_vivo" NO se copian: la plataforma las lee del servicio de Corpocaldas.
Solo usa la biblioteca estándar de Python 3.8+. No modifica los archivos de origen.
"""
import json, os, sys

DECIMALES = 5

def redondear(c):
    if isinstance(c, (int, float)):
        return round(c, DECIMALES)
    return [redondear(x) for x in c]

def procesar(origen, destino):
    with open(origen, encoding='utf-8') as f:
        gj = json.load(f)
    for ft in gj.get('features', []):
        g = ft.get('geometry')
        if g and 'coordinates' in g:
            g['coordinates'] = redondear(g['coordinates'])
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(gj, f, ensure_ascii=False, separators=(',', ':'))
    return len(gj.get('features', []))

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    raiz_origen = sys.argv[1]
    raiz_repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(raiz_repo, 'data', 'catalogo.json'), encoding='utf-8') as f:
        cat = json.load(f)
    ok = fallos = 0; total = 0
    informe = []
    for c in cat['capas']:
        if c.get('estado') != 'local':
            continue
        o = os.path.join(raiz_origen, *c['origen'].split('/'))
        d = os.path.join(raiz_repo, *c['archivo'].split('/'))
        try:
            n = procesar(o, d)
            tam = os.path.getsize(d); total += tam; ok += 1
            informe.append({'archivo': c['archivo'], 'objetos': n, 'kb': round(tam / 1024, 1)})
        except Exception as e:
            fallos += 1
            informe.append({'archivo': c['archivo'], 'error': str(e)})
            print('ERROR', c['origen'], e)
    with open(os.path.join(raiz_repo, 'data', '_informe_preparacion.json'), 'w', encoding='utf-8') as f:
        json.dump({'ok': ok, 'fallos': fallos, 'total_mb': round(total / 1e6, 1), 'capas': informe}, f, ensure_ascii=False, indent=1)
    print(f'Listo: {ok} capas copiadas, {fallos} con error, {total/1e6:.1f} MB en data/.')
    if total > 900e6:
        print('AVISO: supera ~900 MB; GitHub Pages admite 1 GB como máximo.')

if __name__ == '__main__':
    main()
