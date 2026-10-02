"""Descarga los puntos de calor del IDEAM (puntosdecalor.ideam.gov.co) para Colombia, los recorta al entorno de Caldas
y los guarda en data/ideam_caldas.json (desde el 1 de enero del año en curso).
Los puntos son detecciones térmicas satelitales, no incendios confirmados. Hora del IDEAM: local de Colombia (UTC-5).
El servidor del IDEAM publica su certificado sin la cadena intermedia, por eso se omite la verificación TLS (datos públicos, solo lectura)."""
import json, ssl, sys, urllib.request, datetime as dt

ahora = dt.datetime.utcnow()
desde = dt.date(ahora.year, 1, 1).isoformat()
hasta = (ahora.date() + dt.timedelta(days=1)).isoformat()
url = 'https://puntosdecalor.ideam.gov.co/active_fires.json/?from_date=%s&to_date=%s&region=colombia' % (desde, hasta)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
try:
    j = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=90, context=ctx).read())
except Exception as e:
    print('IDEAM no respondió:', e); sys.exit(0)  # se conserva el archivo anterior
pts = [[j['lat'][i], j['lon'][i], j['m'][i]] for i in range(j['n']) if 4.65 < j['lat'][i] < 5.95 and -76.15 < j['lon'][i] < -74.45]
json.dump({'fuente': 'IDEAM · Monitoreo de puntos de calor (puntosdecalor.ideam.gov.co)', 't0': j['t0'], 'span': j['span'],
           'actualizado': ahora.strftime('%Y-%m-%dT%H:%M:%SZ'), 'pts': pts}, open('data/ideam_caldas.json', 'w'), separators=(',', ':'))
print(len(pts), 'puntos en Caldas de', j['n'], 'en Colombia')
