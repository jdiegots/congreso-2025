
import csv

targets = {
    "RDL 14/2025": ["14/2025", "retribuciones"],
    "RDL 13/2025": ["13/2025", "palma"],
    "RDL 9/2025": ["9/2025", "nacimiento"],
    "Ley 9/2025": ["9/2025", "movilidad"],
    "RDL 15/2025": ["15/2025", "inversora"],
}

csv_path = "public/data/out_votaciones/votaciones.csv"

def get_status(row):
    try:
        si = int(row.get('a_favor', 0))
        no = int(row.get('en_contra', 0))
        if si > no: return "APPROVED"
        return "REJECTED"
    except:
        return "UNKNOWN"

try:
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        
        for name, keywords in targets.items():
            print(f"\n=== {name} ===")
            matches = []
            for r in rows:
                text = (r.get('titulo_punto', '') + " " + r.get('texto_expediente', '')).lower()
                if all(k.lower() in text for k in keywords):
                    matches.append(r)
            
            if not matches:
                print("  No matches found by keywords.")
                continue

            for m in matches:
                status = get_status(m)
                print(f"  UID: {m.get('votacion_uid')}")
                print(f"  Date: {m.get('fecha')}")
                print(f"  Title: {m.get('titulo_punto')}")
                print(f"  Text: {m.get('texto_expediente')}")
                print(f"  Result: {m.get('a_favor')} SI - {m.get('en_contra')} NO -> {status}")
                print("  -------------------------")

except Exception as e:
    print(f"Error: {e}")
