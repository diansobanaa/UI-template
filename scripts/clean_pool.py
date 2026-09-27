import sqlite3
import json

conn = sqlite3.connect('agrotech_operational.sqlite3')
cur = conn.cursor()
row = cur.execute("SELECT payload FROM system_topology_pool").fetchone()
if row:
    pool = json.loads(row[0])
    pool['complexes'] = []
    pool['greenhouses'] = []
    cur.execute("UPDATE system_topology_pool SET payload = ?", (json.dumps(pool),))
    conn.commit()
    print("Cleaned system_topology_pool: complexes=0, greenhouses=0")
