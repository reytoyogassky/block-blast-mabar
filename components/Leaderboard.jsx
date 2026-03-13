import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from '../styles/Leaderboard.module.css';

export default function Leaderboard() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    fetchLeaderboard();
    const channel = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leaderboard' }, fetchLeaderboard)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchLeaderboard() {
    const { data } = await supabase
      .from('leaderboard')
      .select('username, score, played_at')
      .order('score', { ascending: false })
      .limit(10);
    if (data) setEntries(data);
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>🏆 Leaderboard</h3>
      {entries.length === 0 && <p className={styles.empty}>Belum ada skor</p>}
      <ol className={styles.list}>
        {entries.map((e, i) => (
          <li key={i} className={`${styles.row} ${i === 0 ? styles.first : ''}`}>
            <span className={styles.rank}>{medals[i] || `#${i+1}`}</span>
            <span className={styles.name}>{e.username}</span>
            <span className={styles.score}>{e.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
