
import csv
import sys

# Keywords for each target
targets = {
    "RDL 14/2025": ["14/2025", "retribuciones"],
    "RDL 13/2025": ["13/2025", "palma"],
    "RDL 9/2025": ["9/2025", "nacimiento"],
    "Ley 9/2025": ["9/2025", "movilidad"],
    "RDL 15/2025": ["15/2025", "inversor"],
}

csv_path = "public/data/out_votaciones/votaciones.csv"

def check(row, keywords):
    text = (row.get('titulo_punto', '') + " " + row.get('texto_expediente', '')).lower()
    return all(k.lower() in text for k in keywords)

try:
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        
        for name, keywords in targets.items():
            matches = [r for r in rows if check(r, keywords)]
            print(f"--- {name} ---")
            if not matches:
                # Try fallback: just number match
                num_k = [k for k in keywords if "/2025" in k]
                matches = [r for r in rows if check(r, num_k)]
                print(f"  (Fallback matches: {len(matches)})")
            
            for m in matches:
                print(f"  UID: {m.get('votacion_uid')} | Title: {m.get('titulo_punto')[:50]}... | Text: {m.get('texto_expediente')[:50]}...")
                
except Exception as e:
    print(f"Error: {e}")
