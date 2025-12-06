import re
import json
import math

def parse_svg(svg_path, output_path):
    print(f"Parsing {svg_path}...")
    
    try:
        with open(svg_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Dimensions
    # viewBox="0 0 1550 1414.0924"
    vb_match = re.search(r'viewBox="([^"]+)"', content)
    if vb_match:
        parts = vb_match.group(1).split()
        width = float(parts[2])
        height = float(parts[3])
    else:
        width = 1550
        height = 1414

    seats = []
    
    # Regex for circles
    # <circle ... cx="..." cy="..." r="..." ... />
    # Attributes can be in any order.
    # We'll find all circle tags, then extract attrs.
    
    # Improved regex to capture attributes within tags
    circle_pattern = re.compile(r'<(circle|ellipse)([^>]+)>')
    
    tags = circle_pattern.findall(content)
    print(f"Found {len(tags)} circles/ellipses tags.")
    
    for tag_type, attrs in tags:
        # Extract cx, cy, r (or rx)
        cx_match = re.search(r'cx="([^"]+)"', attrs)
        cy_match = re.search(r'cy="([^"]+)"', attrs)
        r_match = re.search(r'r="([^"]+)"', attrs)
        rx_match = re.search(r'rx="([^"]+)"', attrs)
        
        if not cx_match or not cy_match:
            continue
            
        cx = float(cx_match.group(1))
        cy = float(cy_match.group(1))
        
        r = 0
        if r_match:
            r = float(r_match.group(1))
        elif rx_match:
            r = float(rx_match.group(1))
            
        # Filter by radius
        # The standard seat radius in this file seems to be ~15.775...
        # Let's filter roughly. 
        if 14 < r < 17:
            seats.append({
                "x": round(cx, 2),
                "y": round(cy, 2),
                "r": round(r, 2)
            })
        else:
            # Check what we are skipping
            # print(f"Skipping circle with r={r}")
            pass

    print(f"Extracted {len(seats)} valid seats.")

    # Sort seats (Y then X is usually good for debugging, D3 doesn't care)
    # seats.sort(key=lambda s: (s['y'], s['x']))
    
    # Save
    output_data = {
        "width": width,
        "height": height,
        "seats": seats
    }
    
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)

if __name__ == "__main__":
    parse_svg('public/images/Congreso_de_los_Diputados_de_la_XV_Legislatura_de_España.svg', 'src/data/seats_data.json')
