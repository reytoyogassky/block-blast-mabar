import { useEffect, useRef } from 'react';
import { drawPieceToCanvas } from '../lib/gameLogic';

export default function PieceCanvas({ shape, color, maxSize = 80 }) {
  const ref = useRef(null);
  const cols = shape[0].length, rows = shape.length;
  const cellSize = Math.floor(Math.min(maxSize / Math.max(rows, cols) - 2, 18));

  useEffect(() => {
    drawPieceToCanvas(ref.current, shape, color, cellSize, 2);
  }, [shape, color, cellSize]);

  return <canvas ref={ref} style={{ display: 'block' }} />;
}
