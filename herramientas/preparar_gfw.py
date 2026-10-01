#!/usr/bin/env python3
"""Convierte el Excel de Global Forest Watch (Colombia, v20260427) en data/gfw_caldas.json.

Se conserva: Colombia (contexto), departamento de Caldas y sus municipios.
Uso: python herramientas/preparar_gfw.py herramientas/_COL_gfw.xlsx
"""
import json, sys, os, openpyxl

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
xlsx = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'herramientas', '_COL_gfw.xlsx')
wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
UMBRALES = (10, 20, 30, 50, 75)
ANIOS = list(range(2001, 2026))

def filas(hoja):
    it = wb[hoja].iter_rows(values_only=True)
    cab = [str(c) for c in next(it)]
    for r in it:
        if r and r[0] is not None:
            yield dict(zip(cab, r))

def clave(d):
    if 'subnational2' in d: return ('CAL', d['subnational2']) if d.get('subnational1') == 'Caldas' else None
    if 'subnational1' in d: return ('DEP', 'Caldas') if d['subnational1'] == 'Caldas' else None
    return ('COL', 'Colombia')

out = {}
def ent(k):
    return out.setdefault(k, {'perdida': {}, 'primaria': None, 'causas': {}, 'causas_primaria': {}, 'carbono': {}})

def n(v): return None if v is None else (int(v) if float(v) == int(v) else round(float(v), 2))

for prefijo in ('Country', 'Subnational 1', 'Subnational 2'):
    for d in filas(prefijo + ' tree cover loss'):
        k = clave(d)
        if not k or d['threshold'] not in UMBRALES: continue
        e = ent(k)
        e['area_ha'] = n(d['area_ha'])
        e['perdida'][str(d['threshold'])] = {'ext2000': n(d['extent_2000_ha']), 'ext2010': n(d['extent_2010_ha']), 'anual': [n(d.get('tc_loss_ha_%d' % a)) for a in ANIOS]}
    for d in filas(prefijo + ' primary loss'):
        k = clave(d)
        if not k: continue
        ent(k)['primaria'] = {'area_ha': n(d.get('area__ha') or d.get('area_ha')), 'anual': [n(d.get('tc_loss_ha_%d' % a)) for a in range(2002, 2026)]}
    for hoja, campo in ((prefijo + ' drivers', 'causas'), (prefijo + ' primary drivers', 'causas_primaria')):
        for d in filas(hoja):
            k = clave(d)
            if not k or d['threshold'] != 30: continue
            e = ent(k)[campo].setdefault(d['driver'], {})
            e[str(d['year'])] = n(d['tc_loss_ha'])
    for d in filas(prefijo + ' carbon data'):
        k = clave(d)
        thr = d['umd_tree_cover_density_2000__threshold']
        if not k or thr not in (30, 50, 75): continue
        ent(k)['carbono'][str(thr)] = {
            'ext2000': n(d['umd_tree_cover_extent_2000__ha']), 'stock_mgc': n(d['gfw_aboveground_carbon_stocks_2000__Mg_C']),
            'dens_mgc_ha': n(d['avg_gfw_aboveground_carbon_stocks_2000__Mg_C_ha-1']),
            'emis_anual': n(d['gfw_forest_carbon_gross_emissions__Mg_CO2e_yr-1']), 'remo_anual': n(d['gfw_forest_carbon_gross_removals__Mg_CO2_yr-1']),
            'neto_anual': n(d['gfw_forest_carbon_net_flux__Mg_CO2e_yr-1']),
            'emis': [n(d.get('gfw_forest_carbon_gross_emissions_%d__Mg_CO2e' % a)) for a in ANIOS]}

res = {'version': 'v20260427', 'anios': [ANIOS[0], ANIOS[-1]], 'umbrales': list(UMBRALES), 'colombia': out[('COL', 'Colombia')], 'caldas': out[('DEP', 'Caldas')],
       'municipios': {k[1]: v for k, v in out.items() if k[0] == 'CAL'}}
dest = os.path.join(RAIZ, 'data', 'gfw_caldas.json')
json.dump(res, open(dest, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print(len(res['municipios']), 'municipios', os.path.getsize(dest) // 1024, 'KB')
