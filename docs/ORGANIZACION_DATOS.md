# Organización de las capas de Corpocaldas

Fuente: copia local `ArcGIS_Corpocaldas_Completo/_raiz` (servicios ArcGIS de Corpocaldas, `swappweb.corpocaldas.gov.co/waserver`).

## Criterios

| Decisión | Detalle |
|---|---|
| Servicios incluidos | 12 servicios de datos; EEP usa `EEPNoviembre2026` (157 capas verificadas en REST). |
| Capas catalogadas | 636 capas de datos (se omiten las capas «grupo», que solo agrupan). |
| Capas en el repositorio (`estado: local`) | 337 capas locales; aproximadamente 202 MB segun el catalogo, antes de reducir coordenadas. |
| Capas en vivo (`estado: en_vivo`) | 298 capas que la plataforma consulta en el servicio de Corpocaldas mediante la `url` del catalogo. |
| Capas vacías (`estado: vacia`) | 1 capa sin registros. |
| Límites de GitHub | Archivo ≤ 100 MB, repositorio recomendado ≤ 1 GB, sitio de Pages ≤ 1 GB. |

## Estructura

```
data/
  catalogo.json            ← índice de todas las capas (tema, grupos, geometría, campos, url, archivo, estado)
  indice_temas.json        ← resumen por tema
  <servicio>/<grupo>/…/<id>_<nombre>.geojson   ← capas locales
herramientas/preparar_datos.py
docs/ORGANIZACION_DATOS.md
```

Los temas salen de los grupos del propio servicio. En los servicios del POT 2a generacion el primer nivel es el municipio (EOT/PBOT); la EEP vigente es `EEPNoviembre2026`.

## Cómo se prepara `data/`

1. Clonar el repositorio con GitHub Desktop.
2. Copiar `data/catalogo.json`, `data/indice_temas.json`, `herramientas/` y `docs/` dentro del clon.
3. Ejecutar desde la raíz del clon:
   `python herramientas/preparar_datos.py "G:\Mi unidad\I+D\ArcGIS_Corpocaldas_Completo\_raiz"`
4. El script copia cada capa local redondeando coordenadas a 5 decimales (≈ 1 m) y minificando el JSON, y genera `data/_informe_preparacion.json`.
5. Revisar el informe, hacer commit y push desde GitHub Desktop.

## Pendiente de decidir

- Qué capas se activan por defecto en cada apartado de la plataforma.
- Si algunas capas pesadas (p. ej. Municipios, Veredas, Microcuencas) se simplifican y se suben, en lugar de leerlas en vivo.
- Posibles duplicados entre `EEPNoviembre2026` y `EE_POT_2da_generacion2026` (hay capas con el mismo nombre en ambos).
