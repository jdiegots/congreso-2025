import csv
import sys

# Increase field size limit just in case
try:
    csv.field_size_limit(1000000)
except:
    pass

with open('public/data/out_votaciones/votaciones.csv', 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.DictReader(f)
    targets = [
        "Real Decreto-ley 5/2025, de 10 de junio, de medidas de promoción del uso del transporte público colectivo por parte de la juventud para los viajes realizados en el periodo estival de 2025.",
        "Real Decreto-ley 12/2025, de 28 de octubre, por el que se adoptan medidas urgentes de reactivación, refuerzo y prevención en el marco del Plan de respuesta inmediata, reconstrucción y relanzamiento frente a los daños causados por la Depresión Aislada en Niveles Altos (DANA) en diferentes municipios entre el 28 de octubre y el 4 de noviembre de 2024.",
        "Real Decreto-ley 13/2025, de 25 de noviembre, por el que se adoptan medidas complementarias urgentes para la recuperación económica y social de la isla de La Palma tras los daños ocasionados por las erupciones volcánicas."
    ]

    for row in reader:
        txt = row.get('texto_expediente', '')
        # Check against all targets
        for t in targets:
            # We use a simple check; user asked "literally", but whitespace in CSV might differ (newlines etc).
            # So we prefer checking normalized strings.
            txt_norm = txt.replace('\n', ' ').replace('\r', '').replace('  ', ' ')
            t_norm = t.replace('\n', ' ').replace('\r', '').replace('  ', ' ')
            
            if t in txt or t_norm in txt_norm:
                short_name = t.split(',')[0] # e.g. "Real Decreto-ley 5/2025"
                print(f"MATCH: {short_name}")
                print(f"  Sesion: {row.get('sesion')}")
                print(f"  Fecha: {row.get('fecha')}")
                print(f"  Votos: Si={row.get('a_favor')}, No={row.get('en_contra')}, Abs={row.get('abstenciones')}")
                print(f"  ID: {row.get('iniciativa_id')}")
                print("-" * 20)
                found = True
