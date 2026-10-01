# Diccionario de campos (tablas de atributos normalizadas)

`data/diccionario_campos.json` describe, para las 637 capas del catálogo, qué campos se muestran y cómo. Lo usan el clic en el mapa y «Mi reporte».

## Qué hace
- **Etiquetas claras**: `MpNombre` → «Nombre municipio»; `Scu_Nombre` → «Nombre subcuenca»; `CODMPO` → «Código municipio».
- **Campos técnicos ocultos**: OBJECTID, FID, GID, SHAPE, THE_GEOM, ESRI_OID, Shape_Area y Shape_Length, entre otros.
- **Rol de cada campo**: nombre, código, municipio, vereda, categoría, área, longitud, fecha, número o texto.
- **Áreas en hectáreas y longitudes en kilómetros, con un solo método**: toda capa de polígonos ofrece «Área calculada (ha)» y toda capa de líneas «Longitud calculada (km)», medidas sobre el elipsoide a partir de la geometría.
- **Unidad deducida del nombre** en los campos propios de la capa (`AREA_HA` → ha, `AREA_KM2` → km², `AREA_M2` → m²). Si no hay unidad, el campo se deja sin unidad.
- **Campos por defecto**: nombre (o categoría) + municipio, si existe, + área/longitud calculada.

## Por qué no se usan Shape_Area / Shape_Length
221 de las 637 capas están en Web Mercator (EPSG:102100) y 36 en MAGNA/Bogotá (21892). En Web Mercator las medidas salen infladas respecto al terreno, y las unidades no son las mismas entre capas. Por eso esos campos se ocultan y se calcula el área o la longitud de la misma forma para todas.

Nota para los reportes: el área calculada es la de cada elemento completo tal como lo entrega el servicio; no es la porción que cae dentro del área de interés.

## Cómo se regenera
1. Leer `MapServer/<id>?f=json` de cada capa y guardar `{"SERVICIO/ID": {geometryType, sr, fields:[…]}}` en `herramientas/_meta_capas.json`.
2. `python herramientas/construir_diccionario.py`
3. Subir `data/diccionario_campos.json`.

Capas sin metadatos del servicio (9, por tiempo de espera o por ser ráster/tabla): se usan los nombres de campo del catálogo y se completan en la siguiente lectura.
