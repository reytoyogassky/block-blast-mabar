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

export const SHAPES_SMALL = [
  [[1]],
  [[1,1]], [[1],[1]],
  [[1,1],[1,1]],
  [[1,1,1]], [[1],[1],[1]],
];

export const SHAPES_MEDIUM = [
  [[1,1],[1,1],[1,1]],
  [[1,1,1],[0,0,1]], [[1,1,1],[1,0,0]],
  [[0,1],[1,1],[1,0]], [[1,0],[1,1],[0,1]],
  [[1,1,1,1]], [[1],[1],[1],[1]],
  [[1,0],[1,0],[1,1]], [[0,1],[0,1],[1,1]],
  [[1,1,0],[0,1,1]], [[0,1,1],[1,1,0]],
  [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]],
];

export const SHAPES_LARGE = [
  [[1,1,1],[1,1,1],[1,1,1]],
  [[1,1,1,1,1]], [[1],[1],[1],[1],[1]],
  [[1],[1],[1],[1]],
];

// ── SHAPES_BRUTAL: blok ekstra susah — muncul di skor tinggi ─────────────────
// Bentuk L/T/Z besar, blok panjang, plus bentuk tak beraturan
export const SHAPES_BRUTAL = [
  // L-shape besar
  [[1,0,0],[1,0,0],[1,1,1]],
  [[0,0,1],[0,0,1],[1,1,1]],
  [[1,1,1],[1,0,0],[1,0,0]],
  [[1,1,1],[0,0,1],[0,0,1]],
  // T-shape besar
  [[1,1,1,1],[0,1,0,0]],
  [[1,1,1,1],[0,0,1,0]],
  // Z/S-shape panjang
  [[1,1,0,0],[0,1,1,0],[0,0,1,1]],
  [[0,0,1,1],[0,1,1,0],[1,1,0,0]],
  // Cross / Plus
  [[0,1,0],[1,1,1],[0,1,0]],
  [[0,1,0,0],[1,1,1,0],[0,1,0,0]],
  // Blok panjang 5
  [[1,1,1,1,1]],
  [[1],[1],[1],[1],[1]],
  // Blok 2x4
  [[1,1,1,1],[1,1,1,1]],
  // Sudut besar
  [[1,1,1,1],[1,0,0,0],[1,0,0,0]],
  [[1,0,0,0],[1,0,0,0],[1,1,1,1]],
  // U-shape
  [[1,0,1],[1,0,1],[1,1,1]],
  // Zigzag panjang
  [[1,1,0],[0,1,0],[0,1,1]],
  [[0,1,1],[0,1,0],[1,1,0]],
];

export const SHAPES = [...SHAPES_SMALL, ...SHAPES_MEDIUM, ...SHAPES_LARGE];

export const randColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

// ── Difficulty level berdasarkan skor ─────────────────────────────────────────
// level 0: normal | 1: medium | 2: hard | 3: brutal
export function getDifficultyLevel(score) {
  if (score >= 8000) return 4;  // INFERNO
  if (score >= 5000) return 3;  // BRUTAL
  if (score >= 2500) return 2;  // HARD
  if (score >= 1000) return 1;  // MEDIUM
  return 0;                     // NORMAL
}

export const DIFFICULTY_LABELS = ['NORMAL', 'MEDIUM', 'HARD', 'BRUTAL', 'INFERNO'];
export const DIFFICULTY_COLORS = ['#29c76a', '#f5a623', '#e86c1e', '#e84040', '#9b45e0'];

/**
 * Buat pool piece berdasarkan difficulty level.
 * Semakin tinggi level → makin besar dan irregular bloknya.
 */
function getShapePool(level) {
  switch (level) {
    case 0: // NORMAL — mix bebas semua ukuran
      return SHAPES;

    case 1: // MEDIUM — kurangi kecil, perbanyak medium
      return [
        ...SHAPES_MEDIUM, ...SHAPES_MEDIUM,  // 2x
        ...SHAPES_LARGE,
        ...SHAPES_SMALL,                      // masih ada tapi jarang
      ];

    case 2: // HARD — dominan large + sebagian brutal
      return [
        ...SHAPES_LARGE, ...SHAPES_LARGE,     // 2x
        ...SHAPES_MEDIUM,
        ...SHAPES_BRUTAL,                     // mulai masuk brutal
      ];

    case 3: // BRUTAL — large + brutal dominan, kecil nyaris hilang
      return [
        ...SHAPES_LARGE, ...SHAPES_LARGE,
        ...SHAPES_BRUTAL, ...SHAPES_BRUTAL,   // 2x brutal
        ...SHAPES_MEDIUM,
      ];

    case 4: // INFERNO — hampir semua brutal, sesekali large
    default:
      return [
        ...SHAPES_BRUTAL, ...SHAPES_BRUTAL, ...SHAPES_BRUTAL, // 3x brutal
        ...SHAPES_LARGE,
        ...SHAPES_MEDIUM.slice(0, 4),         // sedikit medium
      ];
  }
}

export function canPlace(board, shape, r, c) {
  for (let dr = 0; dr < shape.length; dr++)
    for (let dc = 0; dc < shape[dr].length; dc++)
      if (shape[dr][dc]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc]) return false;
      }
  return true;
}

export function pieceFitsAnywhere(board, shape) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (canPlace(board, shape, r, c)) return true;
  return false;
}

export function countFreeCells(board) {
  let free = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!board[r][c]) free++;
  return free;
}

/**
 * Generate 3 pieces guaranteed to fit on the board.
 * score: skor pemain saat ini — menentukan kesulitan piece yang muncul
 */
export function make3Pieces(board = null, score = 0) {
  const level = getDifficultyLevel(score);

  if (!board) {
    // Awal game — selalu mulai dari level 0 (normal)
    return Array.from({ length: 3 }, () => ({
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      color: randColor(),
      id: Math.random().toString(36).slice(2),
      level: 0,
    }));
  }

  const free = countFreeCells(board);
  const pieces = [];

  for (let i = 0; i < 3; i++) {
    let piece = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      let shape;

      if (free < 6) {
        // Papan hampir penuh → paksa kecil biar ga instant game over
        shape = SHAPES_SMALL[Math.floor(Math.random() * SHAPES_SMALL.length)];
      } else if (free < 15) {
        // Papan agak penuh → mix small+medium, abaikan difficulty scaling
        const pool = [...SHAPES_SMALL, ...SHAPES_SMALL, ...SHAPES_MEDIUM];
        shape = pool[Math.floor(Math.random() * pool.length)];
      } else {
        // Papan lega → terapkan difficulty scaling
        const pool = getShapePool(level);
        shape = pool[Math.floor(Math.random() * pool.length)];
      }

      if (pieceFitsAnywhere(board, shape)) {
        piece = {
          shape,
          color: randColor(),
          id: Math.random().toString(36).slice(2),
          level,
        };
        break;
      }
    }

    // Fallback terakhir — 1x1 supaya ga crash
    if (!piece && free > 0) {
      piece = {
        shape: [[1]],
        color: randColor(),
        id: Math.random().toString(36).slice(2),
        level,
      };
    }

    pieces.push(piece || null);
  }

  return pieces;
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
    return pieceFitsAnywhere(board, p.shape);
  });
}

export function calcScore(cellsPlaced, lines) {
  return cellsPlaced * 5 + (lines > 0 ? lines * lines * 60 : 0);
}

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
    ctx.strokeStyle = color.dark;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const shine = ctx.createLinearGradient(x, y, x, y + cellSize * 0.45);
    shine.addColorStop(0, 'rgba(255,255,255,0.26)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fill();

    const shad = ctx.createLinearGradient(x, y + cellSize * 0.65, x, y + cellSize);
    shad.addColorStop(0, 'rgba(0,0,0,0)');
    shad.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = shad;
    ctx.fill();
  }));
}