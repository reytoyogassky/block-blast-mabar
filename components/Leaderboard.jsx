import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from '../styles/Leaderboard.module.css';

// Dedupe: ambil skor tertinggi per username
function dedupeByUsername(data) {
  const map = new Map();
  for (const e of data) {
    if (!map.has(e.username) || e.score > map.get(e.username).score) {
      map.set(e.username, e);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

export default function Leaderboard({ compact = false, roomId = null }) {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    fetchLeaderboard();
    const channel = supabase
      .channel('leaderboard-changes-' + (roomId || 'global'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leaderboard' }, fetchLeaderboard)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [roomId]);

  async function fetchLeaderboard() {
    let query = supabase
      .from('leaderboard')
      .select('username, score, survival_time, played_at')
      .order('score', { ascending: false })
      .limit(50); // ambil banyak dulu, baru dedupe
    if (roomId) query = query.eq('room_id', roomId);
    const { data } = await query;
    if (data) setEntries(dedupeByUsername(data).slice(0, compact ? 5 : 10));
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
      <h3 className={styles.title}>
        {roomId ? '📊 Top Room' : '🏆 Leaderboard'}
      </h3>
      {entries.length === 0 && <p className={styles.empty}>Belum ada skor</p>}
      <ol className={styles.list}>
        {entries.map((e, i) => (
          <li key={e.username} className={`${styles.row} ${i === 0 ? styles.first : ''}`}>
            <span className={styles.rank}>{medals[i] || `#${i+1}`}</span>
            <span className={styles.name}>{e.username}</span>
            {!compact && e.survival_time > 0 && (
              <span className={styles.time}>
                {Math.floor(e.survival_time / 60)}:{String(e.survival_time % 60).padStart(2, '0')}
              </span>
            )}
            <span className={styles.score}>{e.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}