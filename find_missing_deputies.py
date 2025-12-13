import csv
import json

# Cargar diputados.json
with open('public/data/diputados.json', 'r', encoding='utf-8') as f:
    diputados = json.load(f)
diputados_ids = {d['id'] for d in diputados}

# Cargar IDs únicos de votos.csv
votos_ids = set()
nombres_por_id = {}
with open('public/data/out_votaciones/votos.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        vid = row['diputado_id']
        votos_ids.add(vid)
        if vid not in nombres_por_id:
            nombres_por_id[vid] = row['diputado_xml']

# Encontrar IDs faltantes
faltantes = votos_ids - diputados_ids
print(f'IDs faltantes en diputados.json: {len(faltantes)}')
print('=' * 60)
for id in sorted(faltantes, key=lambda x: int(x) if x.isdigit() else 999999):
    print(f'ID {id}: {nombres_por_id.get(id, "?")}')
