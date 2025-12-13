import csv

with open('public/data/out_votaciones/votos.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if 'Cuesta' in row.get('diputado_xml', ''):
            print(f"diputado_id: '{row['diputado_id']}'")
            print(f"diputado_xml: '{row['diputado_xml']}'")
            print(f"Keys: {list(row.keys())}")
            print(f"Full row: {row}")
            break
