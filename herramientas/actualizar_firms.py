"""Descarga los puntos de calor de NASA FIRMS (archivos públicos de 7 días, sin llave) para América del Sur,
los recorta al límite de Caldas y los acumula en data/firms_caldas.json (30 días).
Fuente: NASA FIRMS / LANCE (VIIRS S-NPP, NOAA-20, NOAA-21 y MODIS). Los puntos son detecciones térmicas, no incendios confirmados."""
import csv, io, json, os, sys, urllib.request, datetime as dt

BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/'
FUENTES = {
    'VIIRS_SNPP_NRT':  'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv',
    'VIIRS_NOAA20_NRT': 'noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv',
    'VIIRS_NOAA21_NRT': 'noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv',
    'MODIS_NRT':       'modis-c6.1/csv/MODIS_C6_1_South_America_7d.csv',
}
LAT = (4.7, 5.9); LON = (-76.1, -74.5)   # recorte aproximado de Caldas
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'firms_caldas.json')
DIAS = 30
LIMITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'caldas_limite.json')

def _dentro(x, y, anillo):
    r = False; j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i]; xj, yj = anillo[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: r = not r
        j = i
    return r

def en_caldas(lat, lon):
    """Punto dentro del límite de Caldas (unión de sus 27 municipios); si falta el archivo, usa el recorte rectangular."""
    if not os.path.exists(LIMITE): return True
    global _POLIS
    try: _POLIS
    except NameError: _POLIS = json.load(open(LIMITE, encoding='utf-8'))['poligonos']
    for p in _POLIS:
        if _dentro(lon, lat, p[0]) and not any(_dentro(lon, lat, h) for h in p[1:]): return True
    return False

def bajar(url):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (PGT)'}), timeout=120)
    return r.read().decode('utf-8', 'replace')

def main():
    nuevos = []
    solo = sys.argv[1:] or list(FUENTES)
    for fuente in solo:
        try:
            txt = bajar(BASE + FUENTES[fuente])
        except Exception as e:
            print('FALLO', fuente, e); continue
        n = 0
        for f in csv.DictReader(io.StringIO(txt)):
            try:
                la, lo = float(f['latitude']), float(f['longitude'])
            except Exception:
                continue
            if not (LAT[0] <= la <= LAT[1] and LON[0] <= lo <= LON[1]):
                continue
            if not en_caldas(la, lo):
                continue
            hh = str(f.get('acq_time', '1200')).zfill(4)
            t = dt.datetime.strptime(f['acq_date'] + hh, '%Y-%m-%d%H%M').replace(tzinfo=dt.timezone.utc)
            nuevos.append({'fuente': fuente, 'satelite': f.get('satellite', ''), 'fecha_hora': t.strftime('%Y-%m-%dT%H:%M:%SZ'),
                           'lat': round(la, 5), 'lon': round(lo, 5), 'frp': f.get('frp', ''), 'confianza': f.get('confidence', ''), 'dia_noche': f.get('daynight', '')})
            n += 1
        print(fuente, n, 'puntos en Caldas')
    previos = []
    if os.path.exists(SALIDA):
        try: previos = json.load(open(SALIDA, encoding='utf-8')).get('puntos', [])
        except Exception: previos = []
    corte = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=DIAS)).strftime('%Y-%m-%dT%H:%M:%SZ')
    uni = {}
    for p in previos + nuevos:
        if p['fecha_hora'] >= corte and en_caldas(p['lat'], p['lon']):
            uni[(p['fuente'], p['fecha_hora'], p['lat'], p['lon'])] = p
    pts = sorted(uni.values(), key=lambda p: p['fecha_hora'], reverse=True)
    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    json.dump({'actualizado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'fuente': 'NASA FIRMS (LANCE, ESDIS)', 'puntos': pts}, open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('Total acumulado:', len(pts))

if __name__ == '__main__':
    main()
