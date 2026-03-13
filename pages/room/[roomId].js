import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import {
  emptyBoard, make3Pieces, canPlace, placeOnBoard,
  findClears, clearLines, anyPieceFits, calcScore, ROWS, COLS,
} from '../../lib/gameLogic';
import Board from '../../components/Board';
import PieceCanvas from '../../components/PieceCanvas';
import styles from '../../styles/Room.module.css';

const CS = 46;
const STEP = CS;
const PAD = 8;

function getPlayerId() {
  let id = localStorage.getItem('bb_player_id');
  if (!id) { id = Math.random().toString(36).slice(2, 12).toUpperCase(); localStorage.setItem('bb_player_id', id); }
  return id;
}

export default function RoomPage() {
  const router = useRouter();
  const { roomId, name } = router.query;

  const [myBoard, setMyBoard] = useState(emptyBoard());
  const [myPieces, setMyPieces] = useState(() => make3Pieces());
  const [myScore, setMyScore] = useState(0);
  const [myGameOver, setMyGameOver] = useState(false);

  const [opponent, setOpponent] = useState(null); // {username, board, score, is_game_over}
  const [roomStatus, setRoomStatus] = useState('waiting'); // waiting | playing | finished
  const [players, setPlayers] = useState([]);

  const [drag, setDrag] = useState(null);
  const [snap, setSnap] = useState(null);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [combo, setCombo] = useState(null);
  const [comboKey, setComboKey] = useState(0);
  const [bumping, setBumping] = useState(false);
  const [copied, setCopied] = useState(false);

  const boardRef = useRef(null);
  const playerId = useRef('');
  const username = useRef('');

  // Sync state refs for use in drag handlers without stale closures
  const boardStateRef = useRef(myBoard);
  const piecesStateRef = useRef(myPieces);
  const scoreRef = useRef(myScore);
  const gameOverRef = useRef(myGameOver);
  boardStateRef.current = myBoard;
  piecesStateRef.current = myPieces;
  scoreRef.current = myScore;
  gameOverRef.current = myGameOver;

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    playerId.current = getPlayerId();
    username.current = name || localStorage.getItem('bb_username') || 'Player';

    joinRoom();
    subscribeToRoom();
    subscribeToPlayers();

    // Polling fallback: re-check every 3s while waiting, in case realtime is slow
    const poll = setInterval(async () => {
      const { data: room } = await supabase
        .from('rooms').select('status').eq('id', roomId).single();
      if (!room) return;
      setRoomStatus(prev => {
        if (prev !== room.status) return room.status;
        return prev;
      });
      // If still waiting, re-fetch players to detect new joiner
      if (room.status === 'waiting') fetchPlayers();
      // If playing, clear the interval
      if (room.status !== 'waiting') clearInterval(poll);
    }, 3000);

    return () => {
      clearInterval(poll);
      supabase.removeAllChannels();
    };
  }, [roomId]);

  async function joinRoom() {
    const pieces = make3Pieces();
    setMyPieces(pieces);

    await supabase.from('players').upsert({
      room_id: roomId,
      player_id: playerId.current,
      username: username.current,
      board: emptyBoard(),
      pieces: pieces,
      score: 0,
      is_game_over: false,
    }, { onConflict: 'room_id,player_id' });

    const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
    if (room) setRoomStatus(room.status);

    await fetchPlayers();
  }

  async function fetchPlayers() {
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at');
    if (!data) return;
    setPlayers(data);

    const opp = data.find(p => p.player_id !== playerId.current);
    if (opp) setOpponent(opp);

    // If 2 players present, make sure game starts
    if (data.length >= 2) {
      const { data: room } = await supabase
        .from('rooms')
        .select('status, host_id')
        .eq('id', roomId)
        .single();

      if (room?.status === 'waiting') {
        if (room.host_id === playerId.current) {
          // Host triggers the start — this fires a realtime UPDATE for everyone
          await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
        }
        // Both players set locally immediately — don't wait for realtime
        setRoomStatus('playing');
      } else if (room?.status) {
        setRoomStatus(room.status);
      }
    }
  }

  function subscribeToRoom() {
    supabase.channel(`room-${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}`,
      }, payload => {
        setRoomStatus(payload.new.status);
      })
      .subscribe();
  }

  function subscribeToPlayers() {
    supabase.channel(`players-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}`,
      }, payload => {
        // New player joined — refresh full player list & maybe start game
        fetchPlayers();
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}`,
      }, payload => {
        const changed = payload.new;
        if (!changed || changed.player_id === playerId.current) return;
        setOpponent(changed);
      })
      .subscribe();
  }

  // ── SYNC TO SUPABASE ───────────────────────────────────────────────────────
  const syncDebounce = useRef(null);
  function syncState(board, pieces, score, isGameOver) {
    clearTimeout(syncDebounce.current);
    syncDebounce.current = setTimeout(async () => {
      await supabase.from('players').update({
        board, pieces, score, is_game_over: isGameOver, updated_at: new Date().toISOString(),
      }).eq('room_id', roomId).eq('player_id', playerId.current);
    }, 120);
  }

  // ── DRAG ──────────────────────────────────────────────────────────────────
  function clientToCell(cx, cy) {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const x = cx - rect.left - PAD;
    const y = cy - rect.top - PAD;
    const c = Math.round((x - CS / 2) / STEP);
    const r = Math.round((y - CS / 2) / STEP);
    return { r, c };
  }

  const startDrag = useCallback((idx, e) => {
    if (gameOverRef.current || !piecesStateRef.current[idx]) return;
    if (roomStatus !== 'playing') return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag({ idx, x: cx, y: cy });
    setSnap(null);
  }, [roomStatus]);

  const moveDrag = useCallback((e) => {
    if (!drag) return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag(d => ({ ...d, x: cx, y: cy }));
    const cell = clientToCell(cx, cy);
    if (!cell) { setSnap(null); return; }
    const piece = piecesStateRef.current[drag.idx];
    if (!piece) { setSnap(null); return; }
    setSnap({ r: cell.r, c: cell.c, valid: canPlace(boardStateRef.current, piece.shape, cell.r, cell.c) });
  }, [drag]);

  const endDrag = useCallback((e) => {
    if (!drag) { setDrag(null); setSnap(null); return; }
    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const cell = clientToCell(cx, cy);
    const piece = piecesStateRef.current[drag.idx];
    const ok = cell && piece && canPlace(boardStateRef.current, piece.shape, cell.r, cell.c);
    const savedIdx = drag.idx;
    setDrag(null); setSnap(null);
    if (!ok) return;

    const board = boardStateRef.current;
    const pieces = piecesStateRef.current;
    const placed = piece.shape.flat().filter(Boolean).length;
    const nb = placeOnBoard(board, piece.shape, cell.r, cell.c, piece.color);
    const { rows, cols } = findClears(nb);
    const lines = rows.length + cols.length;
    const pts = calcScore(placed, lines);
    const ns = scoreRef.current + pts;

    setBumping(true); setTimeout(() => setBumping(false), 350);

    const np = [...pieces]; np[savedIdx] = null;
    const fp = np.every(p => !p) ? make3Pieces() : np;

    if (lines > 0) {
      setClearing({ rows, cols });
      if (lines >= 2) { setCombo(`COMBO ×${lines}  +${pts}`); setComboKey(k => k + 1); }
      setTimeout(() => {
        const cb = clearLines(nb, rows, cols);
        setMyBoard(cb); setClearing({ rows: [], cols: [] });
        setMyPieces(fp); setMyScore(ns);
        const over = !anyPieceFits(cb, fp);
        if (over) handleGameOver(ns, cb, fp);
        else syncState(cb, fp, ns, false);
      }, 310);
    } else {
      setMyBoard(nb); setMyPieces(fp); setMyScore(ns);
      const over = !anyPieceFits(nb, fp);
      if (over) handleGameOver(ns, nb, fp);
      else syncState(nb, fp, ns, false);
    }
  }, [drag]);

  async function handleGameOver(finalScore, board, pieces) {
    setMyGameOver(true);
    syncState(board, pieces, finalScore, true);
    // Save to leaderboard
    await supabase.from('leaderboard').insert({
      username: username.current,
      score: finalScore,
      room_id: roomId,
    });
    // Check if all players done
    const { data } = await supabase.from('players').select('is_game_over').eq('room_id', roomId);
    if (data && data.every(p => p.is_game_over)) {
      await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
    }
  }

  useEffect(() => {
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchmove', moveDrag, { passive: false });
    window.addEventListener('touchend', endDrag);
    return () => {
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', moveDrag);
      window.removeEventListener('touchend', endDrag);
    };
  }, [moveDrag, endDrag]);

  // ── GHOST / DISPLAY BOARD ─────────────────────────────────────────────────
  const ghostCells = useMemo(() => {
    const s = new Set();
    if (!snap || drag === null || !myPieces[drag.idx]) return s;
    myPieces[drag.idx].shape.forEach((row, dr) =>
      row.forEach((v, dc) => { if (v) s.add(`${snap.r+dr},${snap.c+dc}`); })
    );
    return s;
  }, [snap, drag, myPieces]);

  const displayBoard = useMemo(() => {
    const d = myBoard.map(r => [...r]);
    if (snap && drag !== null && myPieces[drag.idx] && snap.valid) {
      const p = myPieces[drag.idx];
      p.shape.forEach((row, dr) => row.forEach((v, dc) => {
        if (v) {
          const nr = snap.r + dr, nc = snap.c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !d[nr][nc])
            d[nr][nc] = { ...p.color, ghost: true };
        }
      }));
    }
    return d;
  }, [myBoard, snap, drag, myPieces]);

  let snapBox = null;
  if (snap && drag !== null && myPieces[drag.idx]) {
    const p = myPieces[drag.idx];
    const sw = p.shape[0].length * STEP;
    const sh = p.shape.length * STEP;
    snapBox = (
      <div className={styles.snapRing} style={{
        left: snap.c * STEP + PAD, top: snap.r * STEP + PAD,
        width: sw, height: sh,
        borderColor: snap.valid ? 'rgba(255,255,255,0.3)' : 'rgba(255,60,60,0.5)',
        background: snap.valid ? 'rgba(255,255,255,0.03)' : 'rgba(255,30,30,0.06)',
      }} />
    );
  }

  function copyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }

  const floatPiece = drag !== null && myPieces[drag.idx];
  const winner = useMemo(() => {
    if (roomStatus !== 'finished' && !(myGameOver && opponent?.is_game_over)) return null;
    const myS = myScore;
    const opS = opponent?.score || 0;
    if (myS > opS) return 'you';
    if (opS > myS) return 'opponent';
    return 'draw';
  }, [roomStatus, myGameOver, opponent, myScore]);

  return (
    <>
      <Head><title>Block Blast Mabar — {roomId}</title></Head>
      <div className={styles.page}>
        {/* Room header */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push('/')}>← Lobby</button>
          <button className={styles.codeBtn} onClick={copyCode}>
            Room: <strong>{roomId}</strong> {copied ? '✓ Disalin!' : '📋'}
          </button>
          <div className={styles.statusBadge} data-status={roomStatus}>
            {roomStatus === 'waiting' && '⏳ Menunggu pemain...'}
            {roomStatus === 'playing' && '🎮 Sedang bermain'}
            {roomStatus === 'finished' && '🏁 Selesai'}
          </div>
        </div>

        <div className={styles.arena}>
          {/* MY BOARD */}
          <div className={styles.playerSection}>
            <div className={styles.playerHeader}>
              <span className={styles.playerName}>{username.current || 'Kamu'}</span>
              <span className={`${styles.scoreVal} ${bumping ? styles.bump : ''}`}>
                {myScore.toLocaleString()}
              </span>
            </div>

            <div className={styles.boardWrap} ref={boardRef}>
              <Board
                board={displayBoard}
                clearing={clearing}
                ghostCells={ghostCells}
                ghostValid={snap?.valid ?? true}
              />
              {snapBox}
              {combo && <div key={comboKey} className={styles.combo}>{combo}</div>}
              {myGameOver && (
                <div className={styles.boardOverlay}>
                  <span className={styles.overText}>GAME OVER</span>
                  <span className={styles.overScore}>{myScore.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Tray */}
            <div className={styles.tray}>
              {myPieces.map((p, i) => {
                if (!p) return <div key={i} className={styles.slotEmpty} />;
                const lifting = drag?.idx === i;
                return (
                  <div
                    key={p.id}
                    className={`${styles.slot} ${lifting ? styles.lifting : ''}`}
                    onMouseDown={e => startDrag(i, e)}
                    onTouchStart={e => startDrag(i, e)}
                  >
                    <PieceCanvas shape={p.shape} color={p.color} maxSize={78} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* VS divider */}
          <div className={styles.vs}>VS</div>

          {/* OPPONENT BOARD */}
          <div className={styles.playerSection}>
            {opponent ? (
              <>
                <div className={styles.playerHeader}>
                  <span className={styles.playerName}>{opponent.username}</span>
                  <span className={styles.scoreVal}>{(opponent.score || 0).toLocaleString()}</span>
                </div>
                <div className={styles.boardWrap} style={{ pointerEvents: 'none' }}>
                  <Board board={opponent.board || emptyBoard()} small={false} />
                  {opponent.is_game_over && (
                    <div className={styles.boardOverlay}>
                      <span className={styles.overText}>GAME OVER</span>
                      <span className={styles.overScore}>{(opponent.score || 0).toLocaleString()}</span>
                    </div>
                  )}
                </div>
                <div className={styles.trayMirror}>
                  {(opponent.pieces || []).map((p, i) => (
                    p ? <div key={i} className={styles.slotMini}><PieceCanvas shape={p.shape} color={p.color} maxSize={56} /></div>
                       : <div key={i} className={styles.slotEmpty} />
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.waitingPanel}>
                <div className={styles.waitingDot} />
                <p>Menunggu lawan...</p>
                <p className={styles.waitingHint}>Share kode room ke temanmu!</p>
                <button className={styles.shareBtn} onClick={copyCode}>
                  {copied ? '✓ Disalin!' : `Salin Kode: ${roomId}`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Winner overlay */}
        {winner && (
          <div className={styles.winnerOverlay}>
            <div className={styles.winnerCard}>
              {winner === 'you' && <><div className={styles.winnerEmoji}>🏆</div><div className={styles.winnerTitle}>KAMU MENANG!</div></>}
              {winner === 'opponent' && <><div className={styles.winnerEmoji}>😢</div><div className={styles.winnerTitle}>KAMU KALAH</div></>}
              {winner === 'draw' && <><div className={styles.winnerEmoji}>🤝</div><div className={styles.winnerTitle}>SERI!</div></>}
              <div className={styles.winnerScores}>
                <div><span className={styles.wName}>{username.current}</span><span className={styles.wScore}>{myScore.toLocaleString()}</span></div>
                {opponent && <div><span className={styles.wName}>{opponent.username}</span><span className={styles.wScore}>{(opponent.score||0).toLocaleString()}</span></div>}
              </div>
              <button className={styles.homeBtn} onClick={() => router.push('/')}>← Kembali ke Lobby</button>
            </div>
          </div>
        )}

        {/* Floating drag piece */}
        {floatPiece && (
          <div className={styles.floater} style={{ left: drag.x, top: drag.y }}>
            <PieceCanvas shape={floatPiece.shape} color={floatPiece.color} maxSize={90} />
          </div>
        )}
      </div>
    </>
  );
}