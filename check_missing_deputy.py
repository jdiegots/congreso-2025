import json

with open('public/data/diputados.json', encoding='utf-8') as f:
    data = json.load(f)

# Filtrar diputados del PP con asiento
pp = [d for d in data if d.get('partido') == 'PP' and d.get('asiento') and d.get('asiento') != '-1']
print(f'Total PP con asiento: {len(pp)}')

# Buscar los que no tienen g_par
sin_gpar = [d for d in pp if not d.get('g_par') or d.get('g_par').strip() == '']
print(f'\nPP sin g_par: {len(sin_gpar)}')

for d in sin_gpar:
    print(f'{d["nombre"]} - asiento: {d.get("asiento")} - g_par: "{d.get("g_par")}"')

# Contar total de diputados que cumplen los filtros actuales
total_filtrados = [d for d in data if d.get('asiento') and d.get('asiento') != '-1' and d.get('g_par') and d.get('g_par').strip() != '']
print(f'\nTotal diputados con asiento y g_par: {len(total_filtrados)}')

# Contar por partido
from collections import Counter
partidos = Counter([d.get('partido') for d in total_filtrados])
print(f'\nPP mostrados: {partidos.get("PP", 0)}')
