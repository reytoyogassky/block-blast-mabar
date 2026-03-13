export const COLS = 8;
export const ROWS = 8;

export const COLORS = [
  { bg: '#e84040', dark: '#a02828', light: '#ff9090' },
  { bg: '#2e7de8', dark: '#1a4a9a', light: '#80b8ff' },
  { bg: '#29c76a', dark: '#167a3f', light: '#7aebb0' },
  { bg: '#f5a623', dark: '#a06510', light: '#ffd280' },
  { bg: '#9b45e0', dark: '#5e2096', light: '#cc90ff' },
  { bg: '#18bfaa', dark: '#0d7265', light: '#70e8d8' },
  { bg: '#e86c1e', dark: '#994010', light: '#ffaa70' },
  { bg: '#e0377a', dark: '#8a1a48', light: '#ff88be' },
];

export const SHAPES = [
  [[1,1],[1,1]],
  [[1,1,1],[1,1,1],[1,1,1]],
  [[1,1,1]], [[1],[1],[1]],
  [[1,1],[1,1],[1,1]],
  [[1,1,1],[0,0,1]], [[1,1,1],[1,0,0]],
  [[0,1],[1,1],[1,0]], [[1,0],[1,1],[0,1]],
  [[1]], [[1,1]], [[1],[1]],
  [[1,1,1,1]], [[1],[1],[1],[1]],
  [[1,0],[1,0],[1,1]], [[0,1],[0,1],[1,1]],
  [[1,1,0],[0,1,1]], [[0,1,1],[1,1,0]],
  [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]],
  [[1,1,1,1,1]], [[1],[1],[1],[1],[1]],
];

export const randColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
export const randPiece = () => ({
  shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
  color: randColor(),
  id: Math.random().toString(36).slice(2),
});
export const make3Pieces = () => [randPiece(), randPiece(), randPiece()];
export const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

export function canPlace(board, shape, r, c) {
  for (let dr = 0; dr < shape.length; dr++)
    for (let dc = 0; dc < shape[dr].length; dc++)
      if (shape[dr][dc]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc]) return false;
      }
  return true;
}

export function placeOnBoard(board, shape, r, c, color) {
  const b = board.map(row => [...row]);
  for (let dr = 0; dr < shape.length; dr++)
    for (let dc = 0; dc < shape[dr].length; dc++)
      if (shape[dr][dc]) b[r + dr][c + dc] = color;
  return b;
}

export function findClears(board) {
  const rows = [], cols = [];
  for (let r = 0; r < ROWS; r++) if (board[r].every(c => c)) rows.push(r);
  for (let c = 0; c < COLS; c++) if (board.every(row => row[c])) cols.push(c);
  return { rows, cols };
}

export function clearLines(board, rows, cols) {
  const b = board.map(row => [...row]);
  rows.forEach(r => { for (let c = 0; c < COLS; c++) b[r][c] = null; });
  cols.forEach(c => { for (let r = 0; r < ROWS; r++) b[r][c] = null; });
  return b;
}

export function anyPieceFits(board, pieces) {
  return pieces.some(p => {
    if (!p) return false;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (canPlace(board, p.shape, r, c)) return true;
    return false;
  });
}

export function calcScore(cellsPlaced, lines) {
  return cellsPlaced * 5 + (lines > 0 ? lines * lines * 60 : 0);
}

/** Draw a piece as individual grid cells (with gaps) onto a canvas element */
export function drawPieceToCanvas(canvas, shape, color, cellSize = 14, gap = 2) {
  if (!canvas) return;
  const cols = shape[0].length, rows = shape.length;
  const W = cols * (cellSize + gap) - gap;
  const H = rows * (cellSize + gap) - gap;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const S = cellSize + gap;
  const r = Math.min(6, cellSize * 0.16);

  shape.forEach((row, dr) => row.forEach((v, dc) => {
    if (!v) return;
    const x = dc * S, y = dr * S;

    // Individual rounded cell
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + cellSize - r, y);
    ctx.arcTo(x + cellSize, y, x + cellSize, y + r, r);
    ctx.lineTo(x + cellSize, y + cellSize - r);
    ctx.arcTo(x + cellSize, y + cellSize, x + cellSize - r, y + cellSize, r);
    ctx.lineTo(x + r, y + cellSize);
    ctx.arcTo(x, y + cellSize, x, y + cellSize - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();

    ctx.fillStyle = color.bg;
    ctx.fill();

    // Border
    ctx.strokeStyle = color.dark;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Top shine
    const shine = ctx.createLinearGradient(x, y, x, y + cellSize * 0.45);
    shine.addColorStop(0, 'rgba(255,255,255,0.26)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fill();

    // Bottom shadow
    const shad = ctx.createLinearGradient(x, y + cellSize * 0.65, x, y + cellSize);
    shad.addColorStop(0, 'rgba(0,0,0,0)');
    shad.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = shad;
    ctx.fill();
  }));
}