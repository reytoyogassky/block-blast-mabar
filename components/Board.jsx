import styles from '../styles/Board.module.css';

const CORNER = 8;

function blockRadius(N, S, E, W) {
  const tl = (!N && !W) ? CORNER : 0;
  const tr = (!N && !E) ? CORNER : 0;
  const br = (!S && !E) ? CORNER : 0;
  const bl = (!S && !W) ? CORNER : 0;
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/**
 * board: 8x8 array of null | {bg, dark, light, ghost?}
 * clearing: {rows, cols} arrays of indexes being cleared
 * ghostCells: Set of "r,c" strings
 * ghostValid: bool
 * small: bool — render smaller (opponent view)
 */
export default function Board({ board, clearing = { rows: [], cols: [] }, ghostCells = new Set(), ghostValid = true, small = false }) {
  const CS = small ? 26 : 46;
  const cells = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = `${r},${c}`;
      const color = board[r][c];
      const isClearing = (clearing.rows.includes(r) || clearing.cols.includes(c)) && !!color;
      const isGhostBad = ghostCells.has(key) && !ghostValid;

      if (!color && !isGhostBad) {
        cells.push(
          <div key={key} className={styles.cell} style={{ width: CS, height: CS }}>
            <div className={styles.cellInner} />
          </div>
        );
        continue;
      }

      if (isGhostBad) {
        cells.push(
          <div key={key} className={styles.cell} style={{ width: CS, height: CS }}>
            <div className={styles.ghostBad} />
          </div>
        );
        continue;
      }

      const N = r > 0 && board[r-1][c];
      const S = r < 7 && board[r+1][c];
      const E = c < 7 && board[r][c+1];
      const W = c > 0 && board[r][c-1];
      const rad = blockRadius(N, S, E, W);
      const isGhost = color.ghost;
      const isClr = isClearing;

      cells.push(
        <div key={key} className={`${styles.cell} ${isClr ? styles.clearing : ''}`} style={{ width: CS, height: CS }}>
          <div
            className={styles.block}
            style={{
              background: color.bg,
              borderRadius: rad,
              opacity: isGhost ? 0.5 : 1,
            }}
          >
            {!N && (
              <div className={styles.shine} style={{ borderRadius: `${(!N&&!W)?CORNER:0}px ${(!N&&!E)?CORNER:0}px 0 0` }} />
            )}
            {!S && (
              <div className={styles.shadow} style={{ borderRadius: `0 0 ${(!S&&!E)?CORNER:0}px ${(!S&&!W)?CORNER:0}px` }} />
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <div
      className={styles.board}
      style={{ gridTemplateColumns: `repeat(8, ${CS}px)`, gridTemplateRows: `repeat(8, ${CS}px)` }}
    >
      {cells}
    </div>
  );
}
