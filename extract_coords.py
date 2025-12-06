import cv2
import numpy as np
import json

def extract_seats(image_path, output_path):
    print(f"Processing {image_path}...")
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return

    height, width = img.shape[:2]

    # Canny standard
    edges = cv2.Canny(img, 100, 200) 
    
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print(f"Contours via Canny: {len(contours)}")

    areas = [cv2.contourArea(c) for c in contours]
    if not areas: return
    median_area = np.median(areas)
    print(f"Median Area: {median_area}")

    valid_seats = []
    
    # Very relaxed
    min_area = 20 # Absolute minimum pixels
    max_area = median_area * 5.0

    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area: continue
        if area > max_area: continue
            
        # Circularity - check if it's junk noise
        perimeter = cv2.arcLength(c, True)
        if perimeter == 0: continue
        circularity = 4 * np.pi * (area / (perimeter * perimeter))
        
        # Very permissive circularity
        if circularity < 0.3: 
             continue
        
        M = cv2.moments(c)
        if M["m00"] != 0:
            cX = M["m10"] / M["m00"]
            cY = M["m01"] / M["m00"]
            
            # Filter by region? "350 en la zona inferior"
            # If y > height * 0.9??
            # Let's see if we get ~350 counts first.
            
            valid_seats.append({"x": cX, "y": cY})

    # Deduplicate
    final_seats = []
    threshold_dist = 4.0 # Tight, don't merge close neighbors
    
    for seat in valid_seats:
        is_duplicate = False
        for existing in final_seats:
             dist = np.sqrt((seat['x'] - existing['x'])**2 + (seat['y'] - existing['y'])**2)
             if dist < threshold_dist:
                 is_duplicate = True
                 break
        if not is_duplicate:
            final_seats.append(seat)

    print(f"Filtered seats: {len(final_seats)}")

    output_data = {
        "width": width, 
        "height": height,
        "seats": [{"x": round(s['x'], 2), "y": round(s['y'], 2)} for s in final_seats]
    }

    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)

if __name__ == "__main__":
    extract_seats('public/images/congreso.png', 'src/data/seats_data.json')
