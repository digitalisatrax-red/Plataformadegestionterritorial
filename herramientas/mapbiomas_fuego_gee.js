// MapBiomas Fuego Colombia (Colección 1) → área quemada anual (ha) por municipio de Caldas.
// Ejecutar UNA VEZ en https://code.earthengine.google.com con su cuenta de Earth Engine.
// Datos: MapBiomas Fuego Colombia, Colección 1 (MapBiomas Colombia). Cite la fuente al usarlos.

var BASE = 'projects/mapbiomas-public/assets/colombia/fire/collection1/';
// Nombre del asset verificado en https://colombia.mapbiomas.org/iniciativas-y-productos/fuego/ (CC BY 4.0, citar a MapBiomas).
var ANUAL = ee.Image(BASE + 'mapbiomas_colombia_fire_collection1_annual_burned_v1');

// Municipios de Caldas (FAO GAUL 2015, nivel 2). Si prefiere los de Corpocaldas, suba su capa como asset y cámbiela aquí.
var mun = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.and(ee.Filter.eq('ADM0_NAME', 'Colombia'), ee.Filter.eq('ADM1_NAME', 'Caldas')));
print('Municipios', mun.size());
print('Bandas', ANUAL.bandNames());

var bandas = ANUAL.bandNames();
var ha = ee.Image.pixelArea().divide(10000);

// Una banda por año; píxel > 0 = quemado.
var porAnio = ANUAL.gt(0).multiply(ha).rename(bandas);
var tabla = porAnio.reduceRegions({
  collection: mun, reducer: ee.Reducer.sum(), scale: 30, tileScale: 4
}).map(function (f) { return f.set('nombre', f.get('ADM2_NAME')); });

Export.table.toDrive({
  collection: tabla, description: 'mapbiomas_fuego_caldas', fileFormat: 'CSV',
  selectors: ['nombre'].concat(bandas.getInfo())
});
print('Listo: vaya a la pestaña Tasks y pulse RUN. Luego descargue el CSV de Drive.');
