import sqlite3

conn = sqlite3.connect('agrotech_operational.sqlite3')
cur = conn.cursor()
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print("Tables in agrotech_operational.sqlite3:", tables)
for t in tables:
    name = t[0]
    count = cur.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
    print(f"  {name}: {count} rows")
