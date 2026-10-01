/* GeoCaldas · mapas base con respaldo automático + vista centrada en Caldas.
   El bundle original llama a window.__gcBase(L, proveedor, mapa) al cambiar de mapa base.
   Si un proveedor no entrega teselas (bloqueo, caída, red), se prueba el siguiente de la lista. */
(function () {
  var CALDAS = [[4.7, -76.1], [5.95, -74.6]]; // [sur, oeste] – [norte, este]
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ALT = {
    osm: [
      { u: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', o: { subdomains: 'abcd', maxZoom: 20 }, a: '© OpenStreetMap contributors © CARTO' },
      { u: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19 }, a: 'Tiles © Esri' },
      { u: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', o: { subdomains: 'abcd', maxZoom: 20 }, a: '© OpenStreetMap contributors © CARTO' }
    ],
    light: [
      { u: 'https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', o: { subdomains: 'abcd', maxZoom: 20 }, a: '© OpenStreetMap contributors © CARTO' },
      { u: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 16 }, a: 'Tiles © Esri' },
      { u: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19 }, a: 'Tiles © Esri' }
    ],
    satellite: [
      { u: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19 }, a: 'Tiles © Esri, Maxar, Earthstar Geographics' },
      { u: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19 }, a: 'Tiles © Esri' },
      { u: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', o: { maxZoom: 14 }, a: 'Sentinel-2 cloudless © EOX' }
    ],
    topographic: [
      { u: ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19 }, a: 'Tiles © Esri, HERE, Garmin, OpenStreetMap contributors' },
      { u: ESRI + 'NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 16 }, a: 'Tiles © Esri, National Geographic' },
      { u: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', o: { subdomains: 'abc', maxZoom: 17 }, a: '© OpenStreetMap contributors, SRTM | © OpenTopoMap' }
    ]
  };

  function centrar(map) {
    try { map.invalidateSize(); map.fitBounds(CALDAS, { animate: false, padding: [8, 8] }); } catch (e) {}
  }

  window.__gcBase = function (L, prov, map) {
    var lista = ALT[prov.id] || [{ u: prov.url, o: { maxZoom: prov.maxZoom }, a: prov.attribution }];
    if (!map.__gcCentrado) { // solo la primera vez: encuadrar Caldas
      map.__gcCentrado = true;
      centrar(map);
      setTimeout(function () { centrar(map); }, 400);
      setTimeout(function () { centrar(map); }, 1500);
    }
    var holder = { layer: null, idx: 0, dead: false };
    function poner(i) {
      if (holder.dead) return;
      if (holder.layer) map.removeLayer(holder.layer);
      var p = lista[i], ok = 0, err = 0, opts = { attribution: p.a };
      for (var k in p.o) opts[k] = p.o[k];
      var capa = L.tileLayer(p.u, opts); // sin crossOrigin: no hace falta y algunos servidores lo rechazan
      capa.on('tileload', function () { ok++; });
      capa.on('tileerror', function () {
        err++;
        if (ok === 0 && err >= 3 && holder.idx === i && i + 1 < lista.length) { holder.idx = i + 1; poner(i + 1); }
      });
      capa.addTo(map); capa.bringToBack();
      holder.layer = capa;
      setTimeout(function () { if (!holder.dead && holder.idx === i && ok === 0 && err > 0 && i + 1 < lista.length) { holder.idx = i + 1; poner(i + 1); } }, 6000);
    }
    poner(0);
    // Objeto compatible con el uso del bundle: .remove() y .bringToBack()
    return {
      remove: function () { holder.dead = true; if (holder.layer) map.removeLayer(holder.layer); },
      bringToBack: function () { if (holder.layer) holder.layer.bringToBack(); }
    };
  };
})();
