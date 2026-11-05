var Zizao = Zizao || {};
Zizao.quote = function (value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/[\u0000-\u001f\u2028\u2029]/g, function (ch) {
    var hex = ch.charCodeAt(0).toString(16); return '\\u' + ('0000' + hex).slice(-4);
  }) + '"';
};
Zizao.countLayers = function (layers) {
  var count = 0;
  for (var i = 0; i < layers.length; i++) {
    if (layers[i].typename === 'LayerSet') count += Zizao.countLayers(layers[i].layers);
    else count++;
  }
  return count;
};
Zizao.importPsd = function (filePath, title, mode) {
  var original = app.documents.length ? app.activeDocument : null;
  var originalLayer = original ? original.activeLayer : null;
  var source = null, result = null, inserted = null;
  var dialogs = app.displayDialogs;
  var units = app.preferences.rulerUnits;
  try {
    if (mode !== 'new-document' && mode !== 'insert-layers') throw new Error('导入模式无效。');
    if (mode === 'insert-layers' && !original) throw new Error('请先打开要插入图层的 Photoshop 文档。');
    var file = new File(filePath);
    if (!file.exists || !/\.psd$/i.test(file.name)) throw new Error('PSD 临时文件不存在。');
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;
    source = app.open(file);
    if (mode === 'new-document') {
      result = source.duplicate(title, false);
      source.close(SaveOptions.DONOTSAVECHANGES);
      source = null;
      app.activeDocument = result;
    } else {
      app.activeDocument = original;
      inserted = original.layerSets.add();
      inserted.name = title;
      for (var i = source.layers.length - 1; i >= 0; i--) {
        app.activeDocument = source;
        var layer = source.layers[i];
        var visible = layer.visible;
        var copy = layer.duplicate(inserted, ElementPlacement.PLACEATBEGINNING);
        app.activeDocument = original;
        copy.visible = visible;
      }
      source.close(SaveOptions.DONOTSAVECHANGES);
      source = null;
      app.activeDocument = original;
      original.activeLayer = inserted;
      result = original;
    }
    var count = Zizao.countLayers(inserted ? inserted.layers : result.layers);
    return '{"ok":true,"result":{"documentName":' + Zizao.quote(result.name) + ',"layerCount":' + count + '}}';
  } catch (error) {
    try { if (source) source.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    try { if (inserted) inserted.remove(); } catch (_) {}
    try { if (result && mode === 'new-document') result.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    try { if (original) { app.activeDocument = original; original.activeLayer = originalLayer; } } catch (_) {}
    return '{"ok":false,"error":' + Zizao.quote(error.message || error) + '}';
  } finally {
    app.displayDialogs = dialogs;
    app.preferences.rulerUnits = units;
  }
};
