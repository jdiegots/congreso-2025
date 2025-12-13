#!/usr/bin/env python3
import json

with open('public/data/iniciativas.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update tipo based on titulo
for item in data:
    titulo = (item.get('titulo', '') or '').strip()
    # Check what type it should be
    if titulo.lower().startswith('ley orgánica') or titulo.lower().startswith('ley organica'):
        item['tipo'] = 'Leyes organicas'
    elif titulo.lower().startswith('real decreto-ley'):
        item['tipo'] = 'Reales decretos'
    else:
        # Everything else is Leyes
        item['tipo'] = 'Leyes'

# Write back
with open('public/data/iniciativas.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print('Updated iniciativas.json')

# Count by tipo
tipos = {}
for item in data:
    t = item.get('tipo')
    tipos[t] = tipos.get(t, 0) + 1

print('Counts:')
for t in sorted(tipos.keys()):
    print(f'  {t}: {tipos[t]}')
