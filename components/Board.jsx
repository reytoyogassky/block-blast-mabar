import styles from '../styles/Board.module.css';

const R = 7;

/**
 * board: 8x8 array of null | {bg, dark, light, ghost?}
 * clearing: {rows, cols}
 * ghostCells: Set of "r,c"
 * ghostValid: bool
 * cellSize: number (px) — controls board size, for responsive
 */
export default function Board({
  board,
  clearing = { rows: [], cols: [] },
  ghostCells = new Set(),
  ghostValid = true,
  cellSize = 46,
}) {
  const GAP = Math.max(2, Math.round(cellSize * 0.065));
  const cells = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = `${r},${c}`;
      const color = board[r][c];
      const isClearing = (clearing.rows.includes(r) || clearing.cols.includes(c)) && !!color;
      const isGhostBad = ghostCells.has(key) && !ghostValid;
      const isGhostGood = ghostCells.has(key) && ghostValid && !color;
      const sz = { width: cellSize, height: cellSize };

      if (!color && !isGhostBad && !isGhostGood) {
        cells.push(
          <div key={key} className={styles.cell} style={sz}>
            <div className={styles.empty} style={{ borderRadius: R }} />
          </div>
        );
        continue;
      }

      if (isGhostBad) {
        cells.push(
          <div key={key} className={styles.cell} style={sz}>
            <div className={styles.badGhost} style={{ borderRadius: R }} />
          </div>
        );
        continue;
      }

      if (isGhostGood) {
        cells.push(
          <div key={key} className={styles.cell} style={sz}>
            <div className={styles.goodGhost} style={{ borderRadius: R }} />
          </div>
        );
        continue;
      }

      const isGhost = color.ghost;

      cells.push(
        <div key={key} className={`${styles.cell} ${isClearing ? styles.clearing : ''}`} style={sz}>
          <div
            className={styles.block}
            style={{
              background: color.bg,
              borderColor: color.dark,
              opacity: isGhost ? 0.45 : 1,
              borderRadius: R,
            }}
          >
            <div className={styles.shine} style={{ borderRadius: `${R}px ${R}px 0 0` }} />
            <div className={styles.shadow} style={{ borderRadius: `0 0 ${R}px ${R}px` }} />
          </div>
        </div>
      );
    }
  }

  const totalGrid = cellSize * 8 + GAP * 7;
  const pad = Math.round(cellSize * 0.2);

  return (
    <div
      className={styles.board}
      style={{
        gridTemplateColumns: `repeat(8, ${cellSize}px)`,
        gridTemplateRows: `repeat(8, ${cellSize}px)`,
        gap: GAP,
        padding: pad,
      }}
    >
      {cells}
    </div>
  );
}