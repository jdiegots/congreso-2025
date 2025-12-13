import json
import sys

try:
    with open('public/data/diputados.json', 'r', encoding='utf-8') as f:
        content = f.read()
        data = json.loads(content)
    
    print("JSON cargado correctamente")
    print(f"Total diputados en JSON: {len(data)}")
    
    # Contar los que tienen asiento válido
    with_seat = [d for d in data if d.get('asiento') and str(d.get('asiento')).strip() not in ['', '-1', 'null']]
    print(f"Diputados con asiento válido: {len(with_seat)}")
    
    # Contar los que tienen g_par
    with_gpar = [d for d in with_seat if d.get('g_par') and str(d.get('g_par')).strip() != '']
    print(f"Diputados con asiento y g_par: {len(with_gpar)}")
    
    # Los que tienen asiento pero NO g_par
    without_gpar = [d for d in with_seat if not d.get('g_par') or str(d.get('g_par')).strip() == '']
    print(f"\nDiputados con asiento pero SIN g_par: {len(without_gpar)}")
    
    for d in without_gpar:
        print(f"  - {d.get('nombre')} ({d.get('partido')}) - Asiento: {d.get('asiento')}")
    
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
