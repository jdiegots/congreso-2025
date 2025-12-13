# -*- coding: utf-8 -*-
r"""
build_votes_db.py (pero SIN SQLite)

Lee:
- C:\dev\congreso-2025\public\data\diputados.json
- C:\dev\congreso-2025\public\data\iniciativas.json
- Zips en C:\Users\jdieg\Downloads\votaciones_zips (solo .xml dentro)

Escribe en:
- C:\dev\congreso-2025\public\data\out_votaciones\votaciones.csv
- C:\dev\congreso-2025\public\data\out_votaciones\votos.csv
- reportes de fallos en ...\out_votaciones\reports\*.csv
- resumen en ...\out_votaciones\summary.json
"""


from __future__ import annotations

import csv
import json
import os
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET

# ----------------------------
# Config (paths Windows)
# ----------------------------
DATA_DIR = r"C:\dev\congreso-2025\public\data"
ZIPS_DIR = r"C:\Users\jdieg\Downloads\votaciones_zips"

OUT_DIR = os.path.join(DATA_DIR, "out_votaciones")
REPORTS_DIR = os.path.join(OUT_DIR, "reports")

DIPUTADOS_JSON = os.path.join(DATA_DIR, "diputados.json")
INICIATIVAS_JSON = os.path.join(DATA_DIR, "iniciativas.json")

VOTACIONES_CSV = os.path.join(OUT_DIR, "votaciones.csv")
VOTOS_CSV = os.path.join(OUT_DIR, "votos.csv")

# ----------------------------
# Helpers: normalización
# ----------------------------
WS_RE = re.compile(r"\s+")
LAW_NUM_RE = re.compile(r"\b\d{1,4}/\d{4}\b", re.IGNORECASE)

def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s)
        if not unicodedata.combining(c)
    )

def norm_text(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("\u00ad", "")  # soft hyphen
    s = s.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    s = s.strip().lower()
    s = strip_accents(s)
    # deja / para 12/2023
    s = re.sub(r"[“”\"'.,;:()\[\]{}!?¿¡]", " ", s)
    s = WS_RE.sub(" ", s).strip()
    return s

def norm_name(name: str) -> str:
    t = (name or "").strip()
    if "," in t:
        a, b = [p.strip() for p in t.split(",", 1)]
        t = f"{a} {b}".strip()
    return norm_text(t)

def clean_expediente_text(s: str) -> str:
    t = norm_text(s)
    
    # 0. Remove "dictamen", "convalidacion", "enmienda", etc at start
    # e.g. "Dictamen de la Comision sobre..."
    t = re.sub(r"^(dictamen|convalidaci[oó]n|derogaci[oó]n|enmienda|informe|ratificaci[oó]n)\b.*?(?:sobre|del|de la|de el|de)\b", "", t).strip()

    # 1. Remove standard parliamentary noise
    t = re.sub(r"\bdel grupo parlamentario\b.*?\bpara\b", " para ", t)
    t = re.sub(r"\bde los grupos parlamentarios\b.*?\bpara\b", " para ", t)
    t = re.sub(r"\bdel gobierno\b", "", t)

    # 2. Aggressive prefix removal of Law types
    # Matches: "Ley 9/2025, de 3 de diciembre," OR "Ley 9/2025," OR "Ley"
    # We want to strip the whole "Type Num/Year, date," block to get to the content.
    
    # Regex explanation:
    # (?: ... ) start group of types
    # \s+ \d+/\d{4}  match number (optional?) -> No, typically JSON has number, XML might not.
    # We want to remove "Ley 9/2025, de 3 de diciembre," specifically.
    
    type_pat = r"(?:proyecto de ley org[aá]nica|proyecto de ley|proposici[oó]n de ley|real decreto-ley|real decreto legislativo|ley org[aá]nica|ley)"
    
    # Remove "Type Num/Year, de Date," pattern
    # e.g. "Ley 9/2025, de 3 de diciembre,"
    t = re.sub(r"^" + type_pat + r"\s+\d+/\d{4},?\s+de\s+\d{1,2}\s+de\s+[a-z]+,?", "", t).strip()
    
    # Remove "Type Num/Year" simple
    t = re.sub(r"^" + type_pat + r"\s+\d+/\d{4},?", "", t).strip()

    # Remove just "Type" (if no number)
    t = re.sub(r"^" + type_pat + r"\b", "", t).strip()

    # 3. Connectors removal
    # "por la que se modifica", "de medidas", "relativa a", "de"
    # Be careful with "de" at start if the title is "de Movilidad Sostenible" -> "Movilidad Sostenible"
    
    t = re.sub(r"^(por (la|el) que se (modifica|aprueba|crea|adoptan)|por (la|el) que se|de medidas|relativa? a|de)\b", "", t).strip()
    
    t = WS_RE.sub(" ", t).strip()
    return t

def token_set(s: str) -> set:
    toks = [x for x in norm_text(s).split(" ") if x and len(x) > 2]
    return set(toks)

def token_overlap_score(a: str, b: str) -> float:
    A = token_set(a)
    B = token_set(b)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    return (2.0 * inter) / (len(A) + len(B))

def combined_similarity(a: str, b: str) -> float:
    a2 = norm_text(a)
    b2 = norm_text(b)
    if not a2 or not b2:
        return 0.0
    seq = SequenceMatcher(None, a2, b2).ratio()
    tok = token_overlap_score(a2, b2)
    return 0.6 * seq + 0.4 * tok

def parse_date_ddmmyyyy(s: str) -> Optional[str]:
    s = (s or "").strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%d/%m/%Y")
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None

# ----------------------------
# Carga JSON
# ----------------------------
def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)

def pick_id_field(row: Dict[str, Any], fallback_prefix: str) -> str:
    for k in ("id", "ID", "Id", f"{fallback_prefix}_id", "diputado_id", "initiative_id", "iniciativa_id"):
        if k in row and row[k] not in (None, ""):
            return str(row[k])
    base = json.dumps(row, ensure_ascii=False, sort_keys=True)
    return f"gen_{abs(hash(base))}"

# ----------------------------
# Matching Diputados
# ----------------------------
@dataclass
class DiputadoIndex:
    key_to_ids: Dict[str, List[str]]
    id_to_name: Dict[str, str]

def build_diputado_index(diputados: List[Dict[str, Any]]) -> DiputadoIndex:
    key_to_ids: Dict[str, List[str]] = {}
    id_to_name: Dict[str, str] = {}

    for row in diputados:
        did = pick_id_field(row, "diputado")
        name = str(row.get("nombre") or row.get("name") or row.get("Nombre") or "").strip()
        if not name:
            continue
        id_to_name[did] = name
        key = norm_name(name)
        key_to_ids.setdefault(key, []).append(did)

    return DiputadoIndex(key_to_ids=key_to_ids, id_to_name=id_to_name)

def match_diputado(name_in_xml: str, idx: DiputadoIndex) -> Tuple[Optional[str], str]:
    key = norm_name(name_in_xml)
    ids = idx.key_to_ids.get(key, [])
    if len(ids) == 1:
        return ids[0], "ok"
    if len(ids) > 1:
        return None, "ambiguous"
    return None, "unmatched"

# ----------------------------
# Matching Iniciativas
# ----------------------------
@dataclass
class IniciativaRow:
    iid: str
    titulo: str
    canon: str
    anchors: set
    tokens: set

@dataclass
class IniciativaIndex:
    rows: List[IniciativaRow]
    token_to_i: Dict[str, List[int]]
    anchor_to_i: Dict[str, List[int]]

def build_iniciativa_index(iniciativas: List[Dict[str, Any]]) -> IniciativaIndex:
    rows: List[IniciativaRow] = []
    token_to_i: Dict[str, List[int]] = {}
    anchor_to_i: Dict[str, List[int]] = {}

    for row in iniciativas:
        iid = pick_id_field(row, "iniciativa")
        titulo = str(row.get("titulo") or row.get("Título") or row.get("title") or "").strip()
        canon = clean_expediente_text(titulo)
        anchors = set(LAW_NUM_RE.findall(canon))
        toks = token_set(canon)

        rows.append(IniciativaRow(iid=iid, titulo=titulo, canon=canon, anchors=anchors, tokens=toks))

    for i, r in enumerate(rows):
        for t in r.tokens:
            token_to_i.setdefault(t, []).append(i)
        for a in r.anchors:
            anchor_to_i.setdefault(a, []).append(i)

    return IniciativaIndex(rows=rows, token_to_i=token_to_i, anchor_to_i=anchor_to_i)

def match_iniciativa(texto_expediente: str, idx: IniciativaIndex) -> Tuple[Optional[str], float, str, Optional[Tuple[str, float]]]:
    canon = clean_expediente_text(texto_expediente or "")
    if not canon:
        return None, 0.0, "unmatched", None

    anchors = set(LAW_NUM_RE.findall(canon))

    candidates: set = set()
    for a in anchors:
        for i in idx.anchor_to_i.get(a, []):
            candidates.add(i)

    if not candidates or len(candidates) > 2000:
        toks = token_set(canon)
        for t in toks:
            for i in idx.token_to_i.get(t, []):
                candidates.add(i)

    if not candidates:
        candidates = set(range(len(idx.rows)))

    if len(candidates) > 1500:
        scored = []
        canon_toks = token_set(canon)
        for i in candidates:
            inter = len(idx.rows[i].tokens & canon_toks)
            scored.append((inter, i))
        scored.sort(reverse=True)
        candidates = set(i for _, i in scored[:800])

    best_i = None
    best_score = -1.0
    second_i = None
    second_score = -1.0

    for i in candidates:
        r = idx.rows[i]
        
        # 1. SPECIAL CHECK: Law/Decree Numbers
        # If both contain a "Ley X/2025" or "Real Decreto-ley X/2025" and match, boost score massively.
        # Regex to find "Ley N/YYYY" or "Real Decreto-ley N/YYYY"
        # We use a strict pattern to avoid false positives with dates like 13/2025 (day/year?) no, usually dates are dd/mm/yyyy.
        # number references in titles are usually "Ley 1/2025", "Real Decreto-ley 15/2025".
        
        pat = r"(?:ley|decreto-ley|real decreto-ley|ley org[aá]nica)\s+(\d+/\d{4})"
        m_canon = re.search(pat, canon)
        m_target = re.search(pat, r.canon)
        
        sc = 0.0
        
        if m_canon and m_target:
             if m_canon.group(1) == m_target.group(1):
                 # Strong match on Number ID!
                 # Verify it's not a mismatch of "Ley" vs "Ley Orgánica" if numbers coincide (rare but possible).
                 # If numbers coincide (e.g. 1/2025), it's overwhelmingly likely the same thing.
                 sc = 0.99 
             else:
                 # Numbers differ -> penalize heavily
                 sc = 0.0
        else:
             # Standard fuzzy match
             sc = combined_similarity(canon, r.canon)

        if sc > best_score:
            second_i, second_score = best_i, best_score
            best_i, best_score = i, sc
        elif sc > second_score:
            second_i, second_score = i, sc

    if best_i is None:
        return None, 0.0, "unmatched", None


    best_row = idx.rows[best_i]
    second = None
    if second_i is not None:
        second_row = idx.rows[second_i]
        second = (second_row.iid, float(second_score))

    gap = best_score - (second_score if second_i is not None else 0.0)

    # Relaxed thresholds
    if best_score >= 0.85:
        return best_row.iid, float(best_score), "ok", second
    if best_score >= 0.70 and gap >= 0.05:
        return best_row.iid, float(best_score), "ok", second
    if second_i is not None and gap < 0.05 and best_score >= 0.60:
        return None, float(best_score), "ambiguous", second
    if best_score >= 0.60:
         return None, float(best_score), "ambiguous", second
         
    return None, float(best_score), "unmatched", second


# ----------------------------
# XML parse
# ----------------------------
def first_text(elem: ET.Element, tag: str) -> str:
    child = elem.find(tag)
    if child is None or child.text is None:
        return ""
    return child.text.strip()

def iter_xml_from_zip(zip_path: str) -> Iterable[Tuple[str, bytes]]:
    with zipfile.ZipFile(zip_path, "r") as z:
        for name in z.namelist():
            if name.lower().endswith(".xml"):
                yield name, z.read(name)

# ----------------------------
# CSV helpers
# ----------------------------
def ensure_dirs():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)

def write_csv(path: str, rows: List[Dict[str, Any]], fieldnames: List[str]):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})

# ----------------------------
# Main
# ----------------------------

# ----------------------------
# Main
# ----------------------------
def main() -> int:
    ensure_dirs()

    diputados_data = load_json(DIPUTADOS_JSON)
    iniciativas_data = load_json(INICIATIVAS_JSON)

    if not isinstance(diputados_data, list) or not isinstance(iniciativas_data, list):
        print("ERROR: diputados.json e iniciativas.json deben ser arrays de objetos.", file=sys.stderr)
        return 2

    dip_idx = build_diputado_index(diputados_data)
    ini_idx = build_iniciativa_index(iniciativas_data)

    unmatched_diputados: Dict[str, int] = {}
    ambiguous_diputados: Dict[str, int] = {}
    unmatched_iniciativas: Dict[str, Dict[str, Any]] = {}
    ambiguous_iniciativas: Dict[str, Dict[str, Any]] = {}
    parse_errors: List[Dict[str, Any]] = []

    # New fields for votaciones: Added 'id'
    votaciones_fields = [
        "id", "votacion_uid", "zip_file", "xml_file",
        "sesion", "numero", "fecha",
        "titulo_punto", "texto_expediente",
        "asentimiento", "presentes", "a_favor", "en_contra", "abstenciones", "no_votan",
        "iniciativa_id", "iniciativa_match_status", "iniciativa_match_score", "iniciativa_second_best"
    ]

    # Simplified fields for votos
    # Removed: votacion_uid (replaced by votacion_id), iniciativa_*, asiento, diputado_match_status
    votos_fields = [
        "votacion_id",
        "diputado_id", 
        "diputado_xml", 
        "grupo", "voto"
    ]

    total_votaciones = 0
    total_votos = 0

    # Prepare Votaciones File
    fvot = open(VOTACIONES_CSV, "w", newline="", encoding="utf-8")
    w_vot = csv.DictWriter(fvot, fieldnames=votaciones_fields)
    w_vot.writeheader()

    # Prepare Votos Chunks
    CHUNK_SIZE = 50000
    current_chunk_index = 0
    current_chunk_rows = 0
    generated_chunks = []

    def open_new_chunk():
        nonlocal current_chunk_index, current_chunk_rows
        fname = f"votos_{current_chunk_index}.csv"
        fpath = os.path.join(OUT_DIR, fname)
        f = open(fpath, "w", newline="", encoding="utf-8")
        w = csv.DictWriter(f, fieldnames=votos_fields)
        w.writeheader()
        generated_chunks.append(fname)
        current_chunk_rows = 0
        return f, w

    fvos, w_vos = open_new_chunk()

    zip_files = [
        os.path.join(ZIPS_DIR, f) for f in os.listdir(ZIPS_DIR)
        if f.lower().endswith(".zip")
    ]
    zip_files.sort()

    # Votacion Integer ID Counter
    votacion_int_id = 0


    # Stats accumulation
    # deputy_id -> { si, no, abs, nv, name, party }
    deputy_stats = {}

    for zip_path in zip_files:
        zip_base = os.path.basename(zip_path)

        for xml_name, xml_bytes in iter_xml_from_zip(zip_path):
            try:
                root = ET.fromstring(xml_bytes)
            except Exception as e:
                parse_errors.append({"zip": zip_base, "xml": xml_name, "error": f"XML parse error: {e}"})
                continue

            info = root.find("Informacion")
            totales = root.find("Totales")
            votaciones = root.find("Votaciones")

            if info is None or votaciones is None:
                parse_errors.append({"zip": zip_base, "xml": xml_name, "error": "Estructura inesperada: falta <Informacion> o <Votaciones>"})
                continue

            votacion_int_id += 1 # Increment ID

            sesion = first_text(info, "Sesion")
            numero = first_text(info, "NumeroVotacion")
            fecha_raw = first_text(info, "Fecha")
            fecha = parse_date_ddmmyyyy(fecha_raw) or fecha_raw
            titulo_punto = first_text(info, "Titulo")
            texto_expediente = first_text(info, "TextoExpediente")

            votacion_uid = f"{zip_base}__{xml_name}__S{sesion}_V{numero}_{fecha}".replace(os.sep, "_")

            ini_id, ini_score, ini_status, ini_second = match_iniciativa(texto_expediente, ini_idx)
            ini_second_s = "" if not ini_second else f"{ini_second[0]}:{ini_second[1]:.3f}"

            key = clean_expediente_text(texto_expediente)[:300]
            if ini_status == "unmatched" and key not in unmatched_iniciativas:
                unmatched_iniciativas[key] = {
                    "zip": zip_base, "xml": xml_name, "fecha": fecha, "sesion": sesion, "numero": numero,
                    "titulo_punto": titulo_punto, "texto_expediente": texto_expediente,
                    "best_score": f"{ini_score:.3f}", "second_best": ini_second_s
                }
            if ini_status == "ambiguous" and key not in ambiguous_iniciativas:
                ambiguous_iniciativas[key] = {
                    "zip": zip_base, "xml": xml_name, "fecha": fecha, "sesion": sesion, "numero": numero,
                    "titulo_punto": titulo_punto, "texto_expediente": texto_expediente,
                    "best_score": f"{ini_score:.3f}", "second_best": ini_second_s
                }

            asentimiento = presentes = a_favor = en_contra = abstenciones = no_votan = ""
            if totales is not None:
                asentimiento = first_text(totales, "Asentimiento")
                presentes = first_text(totales, "Presentes")
                a_favor = first_text(totales, "AFavor")
                en_contra = first_text(totales, "EnContra")
                abstenciones = first_text(totales, "Abstenciones")
                no_votan = first_text(totales, "NoVotan")

            w_vot.writerow({
                "id": votacion_int_id,
                "votacion_uid": votacion_uid,
                "zip_file": zip_base,
                "xml_file": xml_name,
                "sesion": sesion,
                "numero": numero,
                "fecha": fecha,
                "titulo_punto": titulo_punto,
                "texto_expediente": texto_expediente,
                "asentimiento": asentimiento,
                "presentes": presentes,
                "a_favor": a_favor,
                "en_contra": en_contra,
                "abstenciones": abstenciones,
                "no_votan": no_votan,
                "iniciativa_id": ini_id or "",
                "iniciativa_match_status": ini_status,
                "iniciativa_match_score": f"{ini_score:.3f}",
                "iniciativa_second_best": ini_second_s,
            })
            total_votaciones += 1

            for v in votaciones.findall("Votacion"):
                # Asiento no longer needed in output, but exists in XML
                dip_xml = first_text(v, "Diputado")
                grupo = first_text(v, "Grupo")
                voto = first_text(v, "Voto")

                dip_id, dip_status = match_diputado(dip_xml, dip_idx)
                if dip_status == "unmatched":
                    k = norm_name(dip_xml)
                    unmatched_diputados[k] = unmatched_diputados.get(k, 0) + 1
                elif dip_status == "ambiguous":
                    k = norm_name(dip_xml)
                    ambiguous_diputados[k] = ambiguous_diputados.get(k, 0) + 1

                # Update Stats
                if dip_id:
                    if dip_id not in deputy_stats:
                        deputy_stats[dip_id] = {"si": 0, "no": 0, "abs": 0, "nv": 0}
                    
                    v_lower = (voto or "").lower().strip()
                    if v_lower in ('sí', 'si'): deputy_stats[dip_id]["si"] += 1
                    elif v_lower == 'no': deputy_stats[dip_id]["no"] += 1
                    elif v_lower in ('abstención', 'abstencion'): deputy_stats[dip_id]["abs"] += 1
                    else: deputy_stats[dip_id]["nv"] += 1

                w_vos.writerow({
                    "votacion_id": votacion_int_id,
                    "diputado_id": dip_id or "",
                    "diputado_xml": dip_xml,
                    "grupo": grupo,
                    "voto": voto,
                })
                total_votos += 1
                current_chunk_rows += 1

                if current_chunk_rows >= CHUNK_SIZE:
                    fvos.close()
                    current_chunk_index += 1
                    fvos, w_vos = open_new_chunk()

    # Close handles
    fvot.close()
    fvos.close()

    # Write Stats
    with open(os.path.join(OUT_DIR, "stats_diputados.json"), "w", encoding="utf-8") as f:
        json.dump(deputy_stats, f, ensure_ascii=False, indent=2)

    unmatched_dip_rows = [{"diputado_xml_norm": k, "veces": v} for k, v in sorted(unmatched_diputados.items(), key=lambda x: -x[1])]
    ambiguous_dip_rows = [{"diputado_xml_norm": k, "veces": v} for k, v in sorted(ambiguous_diputados.items(), key=lambda x: -x[1])]

    write_csv(os.path.join(REPORTS_DIR, "unmatched_diputados.csv"),
              unmatched_dip_rows, ["diputado_xml_norm", "veces"])
    write_csv(os.path.join(REPORTS_DIR, "ambiguous_diputados.csv"),
              ambiguous_dip_rows, ["diputado_xml_norm", "veces"])
    write_csv(os.path.join(REPORTS_DIR, "unmatched_iniciativas.csv"),
              list(unmatched_iniciativas.values()),
              ["zip", "xml", "fecha", "sesion", "numero", "titulo_punto", "texto_expediente", "best_score", "second_best"])
    write_csv(os.path.join(REPORTS_DIR, "ambiguous_iniciativas.csv"),
              list(ambiguous_iniciativas.values()),
              ["zip", "xml", "fecha", "sesion", "numero", "titulo_punto", "texto_expediente", "best_score", "second_best"])
    write_csv(os.path.join(REPORTS_DIR, "parse_errors.csv"),
              parse_errors, ["zip", "xml", "error"])

    summary = {
        "votaciones_csv": VOTACIONES_CSV,
        "votos_chunks": generated_chunks,
        "reports_dir": REPORTS_DIR,
        "votaciones": total_votaciones,
        "votos": total_votos,
        "unmatched_diputados_distintos": len(unmatched_dip_rows),
        "ambiguous_diputados_distintos": len(ambiguous_dip_rows),
        "unmatched_iniciativas_distintas": len(unmatched_iniciativas),
        "ambiguous_iniciativas_distintas": len(ambiguous_iniciativas),
        "parse_errors": len(parse_errors),
    }
    with open(os.path.join(OUT_DIR, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("OK")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
