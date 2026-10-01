"""Convierte el CSV exportado por mapbiomas_fuego_gee.js a data/mapbiomas_fuego_caldas.json.
Uso: python convertir_mapbiomas.py mapbiomas_fuego_caldas.csv"""
import csv, json, re, sys, datetime
fn = sys.argv[1]
rows = list(csv.DictReader(open(fn, encoding='utf-8-sig')))
cols = [c for c in rows[0] if re.search(r'(19|20)\d\d', c)]
anios = sorted({int(re.search(r'((?:19|20)\d\d)', c).group(1)) for c in cols})
col_de = {int(re.search(r'((?:19|20)\d\d)', c).group(1)): c for c in cols}
out = {'fuente': 'MapBiomas Fuego Colombia, Colección 1', 'generado': datetime.date.today().isoformat(), 'anios': anios,
       'municipios': [{'nombre': r['nombre'], 'ha': [round(float(r[col_de[a]] or 0), 1) for a in anios]} for r in rows]}
json.dump(out, open('../data/mapbiomas_fuego_caldas.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(len(rows), 'municipios;', anios[0], '-', anios[-1])
