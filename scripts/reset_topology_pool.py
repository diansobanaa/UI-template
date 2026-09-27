import sqlite3
import json
from datetime import datetime, timezone

conn = sqlite3.connect('agrotech_operational.sqlite3')
cur = conn.cursor()
row = cur.execute("SELECT pool_json FROM topology_pool WHERE pool_id = 'default'").fetchone()
if row:
    pool = json.loads(row[0])
    pool['complexes'] = []
    pool['greenhouses'] = []
    cur.execute("UPDATE topology_pool SET pool_json = ?, updated_at = ? WHERE pool_id = 'default'", (json.dumps(pool), datetime.now(timezone.utc).isoformat()))
    conn.commit()
    print("Topology pool cleared to 0 complexes and 0 greenhouses.")
else:
    print("No default pool found.")
