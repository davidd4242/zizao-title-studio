import { memo, useId, useMemo } from 'react';
import type { Layer, TextStyle } from './types';
import { contentBounds, layerSvg } from './engine';

export default memo(function ArtworkPreview({ layer, style }: { layer: Layer; style?: TextStyle }) {
  const id = useId();
  const drawing = useMemo(() => {
    const copy = { ...layer, id: `preview-${id}`, style: style || layer.style, x: layer.width / 2, y: layer.height / 2, scaleX: 1, scaleY: 1, rotation: 0, visible: true };
    const b = contentBounds({ version: 1, name: '', width: Math.max(1, copy.width), height: Math.max(1, copy.height), layers: [copy] });
    return { viewBox: `${b.x - 8} ${b.y - 8} ${Math.max(1, b.width + 16)} ${Math.max(1, b.height + 16)}`, html: layerSvg(copy) };
  }, [layer, style, id]);
  return <svg aria-hidden="true" viewBox={drawing.viewBox} dangerouslySetInnerHTML={{ __html: drawing.html }} />;
});
