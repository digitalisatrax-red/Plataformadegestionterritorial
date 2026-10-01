#!/usr/bin/env python3
"""Construye data/diccionario_campos.json: tabla de atributos normalizada de las capas de Corpocaldas.

Entradas : data/catalogo.json y metadatos de campos leídos de cada capa (MapServer/<id>?f=json),
           guardados en un JSON {"SERVICIO/ID": {geometryType, sr, fields:[{name,alias,type}]}}.
Salida   : data/diccionario_campos.json

Reglas
- Campos técnicos (OBJECTID, FID, SHAPE, GID, …) quedan ocultos.
- Cada campo recibe una etiqueta legible y un rol (nombre, codigo, municipio, area, longitud, fecha, …).
- Áreas y longitudes: los campos Shape_Area / Shape_Length NO son confiables (muchas capas están en
  Web Mercator 102100 y las medidas salen infladas). Toda capa de polígonos ofrece «Área (ha)» y toda
  de líneas «Longitud (km)», calculadas por la plataforma sobre elipsoide con el mismo método.
- Campos de área/longitud propios de la capa se conservan con su unidad deducida del nombre.
"""
import json, re, sys, os, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(RAIZ, 'data', 'catalogo.json'), encoding='utf8'))['capas']
meta = {}
for ruta in sys.argv[1:] or [os.path.join(RAIZ, 'herramientas', '_meta_capas.json')]:
    meta.update(json.load(open(ruta, encoding='utf8')))

TECNICO = re.compile(r'^(objectid(_?\d+)?|oid|esri_oid|fid(_\w+)?|gid|shape(_?\w*)?|the_geom|globalid|rowid|sid|srsid|ruleid|symbol|st_area\w*|st_length\w*|geom|id_geom|created_\w+|last_edited_\w+|global_id)$', re.I)
SHAPE_MED = re.compile(r'^shape[_ ]?(area|leng\w*|le_?\d*|len\w*)$', re.I)

TOK = {'cod': 'Código', 'codigo': 'Código', 'nom': 'Nombre', 'nombre': 'Nombre', 'mun': 'Municipio', 'mpio': 'Municipio',
       'dep': 'Departamento', 'depto': 'Departamento', 'cue': 'Cuenca', 'cuenca': 'Cuenca', 'obs': 'Observaciones',
       'observ': 'Observaciones', 'observacio': 'Observaciones', 'fue': 'Fuente', 'per': 'Permiso', 'ver': 'Vereda', 'vereda': 'Vereda',
       'resol': 'Resolución', 'est': 'Estado', 'estado': 'Estado', 'tipo': 'Tipo', 'cat': 'Categoría', 'categoria': 'Categoría',
       'fecha': 'Fecha', 'anio': 'Año', 'year': 'Año', 'ord': 'Orden', 'orden': 'Orden', 'poblacion': 'Población', 'clima': 'Clima',
       'altura': 'Altura', 'ha': 'ha', 'km': 'km', 'km2': 'km²', 'm2': 'm²', 'id': 'ID', 'dir': 'Dirección', 'direccion': 'Dirección',
       'strahl': 'Strahler', 'strahle': 'Strahler', 'zph': 'ZPH', 'zh': 'zona hidrográfica', 'szh': 'subzona hidrográfica',
       'cca': 'cuenca', 'scca': 'subcuenca', 'miccca': 'microcuenca', 'mic': 'microcuenca', 'valor': 'Valor', 'rango': 'Rango',
       'riesgo': 'Riesgo', 'amenaza': 'Amenaza', 'vuln': 'Vulnerabilidad', 'indicador': 'Indicador', 'escenario': 'Escenario',
       'proyecto': 'Proyecto', 'contrato': 'Contrato', 'predio': 'Predio', 'verificado': 'Verificado', 'ocurrencia': 'Ocurrencia',
       'coor': 'Coordenada', 'coorx': 'Coordenada X', 'coory': 'Coordenada Y', 'x': 'X', 'y': 'Y', 'area': 'Área', 'long': 'Longitud',
       'length': 'Longitud', 'perimeter': 'Perímetro', 'unidad': 'Unidad', 'completo': 'completo', 'vigencia': 'Vigencia', 'decla': 'declarada', 'admon': 'administrativo', 'anp': 'ANP', 'igac': 'IGAC', 'ideam': 'IDEAM', 'has': 'ha', 'codmpo': 'Código municipio', 'coddep': 'Código departamento', 'codver': 'Código vereda', 'codanp': 'Código ANP', 'codds': 'Código DS', 'codcuenca': 'Código cuenca'}

def sin_tilde(t):
    return ''.join(c for c in unicodedata.normalize('NFD', t) if unicodedata.category(c) != 'Mn')

PREF = {'mp': 'municipio', 'scu': 'subcuenca', 'cue': 'cuenca', 'fue': 'fuente', 'vrt': 'vertiente', 'mun': 'municipio', 'dep': 'departamento'}
SUF = {'nombre': 'Nombre', 'codigo': 'Código', 'cod': 'Código', 'area': 'Área', 'areaha': 'Área (ha)', 'categor': 'Categoría', 'altitud': 'Altitud',
       'norma': 'Norma', 'perime': 'Perímetro', 'estado': 'Estado', 'tipo': 'Tipo', 'orden': 'Orden', 'nomant': 'Nombre anterior', 'longm': 'Longitud (m)'}

def etiqueta(nombre, alias):
    a = (alias or '').strip()
    if a and a.lower() != nombre.lower() and not re.fullmatch(r'[A-Z0-9_]+', a):
        return a[:1].upper() + a[1:]
    toks = [t for t in re.split(r'[_\s]+', nombre.strip('_')) if t]
    if len(toks) == 1:
        low = sin_tilde(toks[0].lower())
        for pf, pn in PREF.items():
            if low.startswith(pf) and low[len(pf):] in SUF:
                return SUF[low[len(pf):]] + ' ' + pn
    if len(toks) == 2 and sin_tilde(toks[0].lower()) in PREF and sin_tilde(toks[1].lower()) in SUF:
        return SUF[sin_tilde(toks[1].lower())] + ' ' + PREF[sin_tilde(toks[0].lower())]
    out = []
    for t in toks:
        k = sin_tilde(t.lower())
        out.append(TOK.get(k) or (t if re.fullmatch(r'\d+', t) else t.lower()))
    s = ' '.join(out)
    return (s[:1].upper() + s[1:]) if s else nombre

def rol_y_unidad(nombre, alias, tipo):
    n = sin_tilde((nombre + ' ' + (alias or '')).lower())
    u = None
    if re.search(r'area|superficie|hect', n) and not re.search(r'areal|arear', n) or re.search(r'(^|_)(ha|hectareas?)(_|$|\d)', n):
        if re.search(r'km2|km_2|kilometros', n): u = 'km²'
        elif re.search(r'(^|[^a-z])m2|metros', n): u = 'm²'
        elif re.search(r'(^|[^a-z_])ha($|[^a-z])|hect|_ha|areaha|areah\b', n): u = 'ha'
        return 'area', u
    if re.search(r'(^|[^a-z])(long|length|leng|perim)', n):
        return 'longitud', ('km' if re.search(r'(^|_)km', n) else 'm' if re.search(r'(^|_)m($|_)|metros', n) else None)
    if tipo == 'esriFieldTypeDate' or re.search(r'(^|[^a-z])(fecha|date)', n): return 'fecha', None
    if re.search(r'nombre|(^|[^a-z])(nom|name)([^a-z]|$)', n) or re.fullmatch(r'nom\w*', n): return 'nombre', None
    if re.search(r'munic|mpio|codmpo', n): return 'municipio', None
    if re.search(r'vereda|codver|(^|_)ver($|_)', n): return 'vereda', None
    if re.search(r'cod|(^|_)id($|_)|(^|_)n_|identificador|consecutivo', n): return 'codigo', None
    if re.search(r'categor|tipo|clase|estado|zonif|cobertura', n): return 'categoria', None
    if tipo in ('esriFieldTypeDouble', 'esriFieldTypeSingle', 'esriFieldTypeInteger', 'esriFieldTypeSmallInteger'): return 'numero', None
    return 'texto', None

GEO = {'esriGeometryPolygon': 'poligono', 'esriGeometryPolyline': 'linea', 'esriGeometryPoint': 'punto', 'esriGeometryMultipoint': 'punto'}
salida, resumen = {}, {'capas': 0, 'sin_meta': 0, 'campos_visibles': 0, 'campos_tecnicos': 0}
for c in cat:
    k = c['servicio'] + '/' + str(c['id'])
    m = meta.get(k)
    resumen['capas'] += 1
    if m and m.get('fields'):
        fs = [(f['name'], f.get('alias'), f['type']) for f in m['fields']]
        geom = GEO.get(m.get('geometryType'), c.get('geometria'))
        sr = m.get('sr') if not isinstance(m.get('sr'), dict) else m['sr'].get('wkid')
    else:
        resumen['sin_meta'] += 1
        fs = [(n, None, 'esriFieldTypeString') for n in c.get('campos', [])]
        geom = c.get('geometria'); sr = None
    vis, ocultos = [], []
    for nombre, alias, tipo in fs:
        if tipo in ('esriFieldTypeGeometry', 'esriFieldTypeBlob', 'esriFieldTypeRaster', 'esriFieldTypeOID') or TECNICO.match(nombre):
            ocultos.append(nombre); continue
        if SHAPE_MED.match(nombre):
            ocultos.append(nombre); continue
        rol, u = rol_y_unidad(nombre, alias, tipo)
        lab = etiqueta(nombre, alias)
        if u and '(' not in lab and u.lower() not in lab.lower(): lab += ' (' + u + ')'
        e = {'n': nombre, 'e': lab, 'r': rol}
        if u: e['u'] = u
        if tipo == 'esriFieldTypeDate': e['d'] = 1
        vis.append(e)
    # campos calculados por la plataforma
    calc = []
    if geom == 'poligono': calc.append({'n': '__area_ha', 'e': 'Área calculada (ha)', 'r': 'area', 'u': 'ha', 'c': 1})
    if geom == 'linea': calc.append({'n': '__long_km', 'e': 'Longitud calculada (km)', 'r': 'longitud', 'u': 'km', 'c': 1})
    # campos por defecto: nombre + (área o longitud calculada) + municipio si existe
    pref = []
    nom = [e for e in vis if e['r'] == 'nombre'][:1]
    mun = sorted([e for e in vis if e['r'] == 'municipio'], key=lambda e: e['e'].startswith('Código'))[:1]
    cat_ = [e for e in vis if e['r'] == 'categoria'][:1]
    pref = [e['n'] for e in nom + (cat_ if not nom else [])] + [e['n'] for e in mun]
    pref += [x['n'] for x in calc]
    if not pref: pref = [e['n'] for e in vis[:3]]
    d = {'g': geom, 'sr': sr, 'campos': vis + calc, 'def': pref, 'ocultos': ocultos}
    if sr == 102100: d['aviso'] = 'Capa en Web Mercator: Shape_Area/Shape_Length están inflados; use área/longitud calculada.'
    salida[k] = d
    resumen['campos_visibles'] += len(vis); resumen['campos_tecnicos'] += len(ocultos)

dest = os.path.join(RAIZ, 'data', 'diccionario_campos.json')
json.dump({'version': 1, 'nota': 'Tabla de atributos normalizada. n=campo, e=etiqueta, r=rol, u=unidad, c=calculado por la plataforma.',
           'capas': salida}, open(dest, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print(resumen, os.path.getsize(dest) // 1024, 'KB')
