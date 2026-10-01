# Organización de las capas de Corpocaldas

Fuente: copia local `ArcGIS_Corpocaldas_Completo/_raiz` (servicios ArcGIS de Corpocaldas, `swappweb.corpocaldas.gov.co/waserver`).

## Criterios

| Decisión | Detalle |
|---|---|
| Servicios incluidos | 12 de 13 carpetas con capas. Se excluye `EEPCaldas2026Marzo` (versión anterior de `EEPJulio2026`). |
| Capas catalogadas | 637 capas de datos (se omiten las capas «grupo», que solo agrupan). |
| Capas en el repositorio (`estado: local`) | 476 capas de 5 MB o menos en origen, ≈ 315 MB antes de reducir coordenadas. |
| Capas en vivo (`estado: en_vivo`) | 160 capas pesadas (mayores de 5 MB) o ráster; la plataforma las lee del servicio de Corpocaldas con la `url` del catálogo. |
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

Los temas salen de los grupos del propio servicio. En los servicios del POT 2.ª generación el primer nivel es el municipio (EOT/PBOT), y en la estructura ecológica de julio de 2026 es «Estructura Ecológica Principal».

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
- Posibles duplicados entre `EEPJulio2026` y `EE_POT_2da_generacion2026` (hay capas con el mismo nombre en ambos).
