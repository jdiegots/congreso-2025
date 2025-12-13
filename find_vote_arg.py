import csv
import sys

# Increase field size limit just in case
try:
    csv.field_size_limit(1000000)
except:
    pass

target_short = sys.argv[1]

with open('public/data/out_votaciones/votaciones.csv', 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.DictReader(f)
    for row in reader:
        txt = row.get('texto_expediente', '')
        if target_short in txt:
            print(f"RES: S={row.get('sesion')}|F={row.get('fecha')}|Si={row.get('a_favor')}|No={row.get('en_contra')}|Abs={row.get('abstenciones')}|ID={row.get('iniciativa_id')}")
            break
