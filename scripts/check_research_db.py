import sqlite3

con = sqlite3.connect("agrotech_research.sqlite3")
cur = con.cursor()
tables = [row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)
counts = {}
for t in tables:
    counts[t] = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
print("Research counts:", counts)
