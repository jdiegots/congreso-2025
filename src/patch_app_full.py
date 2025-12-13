
import os

file_path = r'c:\dev\congreso-2025\src\App.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the end of App component
# We look for the pattern:
#       </div >
#       );
# }

end_index = -1
for i in range(len(lines) - 3):
    if "</div >" in lines[i] and ");" in lines[i+1] and "}" in lines[i+2].strip():
        # Double check indentation or context if needed, but this pattern is quite specific at the end of App.
        # Line i+2 should be the closing brace of App.
        end_index = i + 2
        break

if end_index == -1:
    print("Could not find end of App component")
    # Fallback search for just the ending sequence
    for i in range(len(lines)-1, 0, -1):
        if lines[i].strip() == "}":
            # Check previous lines
            if ");" in lines[i-1]:
                end_index = i
                break
    
    if end_index == -1:
        print("Still could not find end. Aborting.")
        exit(1)

print(f"Truncating after line {end_index + 1}: {lines[end_index]}")

# Keep lines up to end_index (inclusive)
new_lines = lines[:end_index+1]

# Append the new code
new_code = """

// ==========================================
// SUB-COMPONENT: LegislativeSwarm
// ==========================================
function LegislativeSwarm({ scrollY, allVotes, iniciativasData, width, height, isMobile }) {
  // 1. CONFIGURATION
  const SECTION_START = 34000;
  const SECTION_TRANSITION = 4000;
  const SECTION_END = 45000;

  const rawP = (scrollY - SECTION_START) / SECTION_TRANSITION;
  const progress = Math.min(1, Math.max(0, rawP));

  // Only render if we are near the section
  if (scrollY < SECTION_START - 2000) return null;

  // 2. DATA PROCESSING
  const { nodes, categories } = useMemo(() => {
    if (!iniciativasData) return { nodes: [], categories: [] };

    // Define Categories and Colors (Sober Palette)
    const categoryConfig = {
      "Aprobadas": { color: "#2F855A", label: "Aprobadas" },   // Green
      "Rechazadas": { color: "#C53030", label: "Rechazadas" }, // Red
      "En trámite": { color: "#3182CE", label: "En trámite" }, // Blue
      "Retiradas": { color: "#718096", label: "Retiradas" },   // Gray
      "Decaídas": { color: "#D69E2E", label: "Decaídas" }      // Mustard
    };
    
    // Ordered keys for display
    const catKeys = ["Aprobadas", "En trámite", "Rechazadas", "Retiradas", "Decaídas"];

    // Helper to normalize types
    const isLegislative = (type) => {
      const t = (type || "").toLowerCase();
      if (t.includes("real decreto") || t.includes("reales decretos")) return "Reales decretos";
      if (t.includes("orgánica")) return "Leyes orgánicas";
      if (t.includes("ley")) return "Leyes";
      return null;
    };

    // Process nodes
    const processed = [];
    
    iniciativasData.forEach(ini => {
      // Filter Legislative
      const normalizedType = isLegislative(ini.tipo);
      if (!normalizedType) return;

      // Determine Category
      let status = null;
      const result = (ini.resultado_tramitacion || "").trim();
      const situacion = (ini.situacion_actual || "").trim();

      if (result === "Aprobado") status = "Aprobadas";
      else if (result === "Rechazado") status = "Rechazadas";
      else if (result === "Retirado") status = "Retiradas";
      else if (result === "Decaido" || result === "Decaído") status = "Decaídas";
      else if (situacion !== "Cerrado" && situacion !== "" && situacion !== null) status = "En trámite";
      
      // Skip if doesn't fit into these 5 buckets
      if (!status) return;

      processed.push({
        id: ini.id || Math.random(), 
        titulo: ini.titulo,
        tipo: normalizedType,
        status: status,
        color: categoryConfig[status].color,
        data: ini,
        x: width / 2 + (Math.random() - 0.5) * 50,
        y: height / 2 + (Math.random() - 0.5) * 50,
        r: isMobile ? 3 : 4.5
      });
    });

    // SIMULATIONS
    
    // 1. Cloud State (Initial)
    const simulationCloud = d3.forceSimulation(processed)
      .force("charge", d3.forceManyBody().strength(-2))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(d => d.r + 1))
      .stop();

    for (let i = 0; i < 120; i++) simulationCloud.tick();
    processed.forEach(n => { n.cloudX = n.x; n.cloudY = n.y; });

    // 2. Cluster State (Categorized)
    const colWidth = width / catKeys.length;
    
    const simulationCluster = d3.forceSimulation(processed)
      .force("x", d3.forceX(d => {
        const idx = catKeys.indexOf(d.status);
        return (idx + 0.5) * colWidth;
      }).strength(0.8))
      .force("y", d3.forceY(height / 2).strength(0.2))
      .force("collide", d3.forceCollide(d => d.r + 1))
      .stop();

    for (let i = 0; i < 150; i++) simulationCluster.tick();
    processed.forEach(n => { n.clusterX = n.x; n.clusterY = n.y; });

    return { nodes: processed, categories: catKeys };
  }, [iniciativasData, width, height, isMobile]);


  // 3. INTERACTION
  const [selectedNode, setSelectedNode] = useState(null);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0,
      width: '100%', height: '100%',
      pointerEvents: 'none', 
      zIndex: 60,
      opacity: Math.min(1, (scrollY - SECTION_START + 500) / 500) // Fade in
    }}>
      {/* CLUSTER LABELS */}
      <div style={{
        position: 'absolute',
        top: '15%',
        width: '100%',
        display: 'flex',
        justifyContent: 'space-around',
        opacity: Math.max(0, (progress - 0.5) * 2),
        transition: 'opacity 0.3s ease'
      }}>
        {categories.map(cat => {
          const count = nodes.filter(n => n.status === cat).length;
          return (
            <div key={cat} style={{ textAlign: 'center', width: `${100/categories.length}%` }}>
              <div style={{ 
                fontFamily: 'var(--font-serif)', 
                fontWeight: 700, 
                fontSize: isMobile ? '12px' : '16px', 
                color: '#111',
                marginBottom: '4px'
              }}>
                {cat}
              </div>
              <div style={{ 
                fontFamily: 'var(--font-sans)', 
                fontWeight: 600,
                fontSize: isMobile ? '16px' : '24px', 
                color: '#555' 
              }}>
                {count}
              </div>
            </div>
          );
        })}
      </div>

      {/* SVG CANVAS */}
      <svg width={width} height={height} style={{ pointerEvents: 'none' }}>
        {nodes.map((node) => {
          // Interpolate positions
          const x = node.cloudX + (node.clusterX - node.cloudX) * progress;
          const y = node.cloudY + (node.clusterY - node.cloudY) * progress;
          
          const isSelected = selectedNode && selectedNode.id === node.id;

          return (
            <circle
              key={node.id}
              cx={x}
              cy={y}
              r={isSelected ? (node.r * 2.5) : node.r}
              fill={node.color}
              stroke="white"
              strokeWidth={isSelected ? 2 : 0.5}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                transition: 'r 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), stroke-width 0.2s',
                opacity: 0.9
              }}
              onClick={() => setSelectedNode(isSelected ? null : node)}
            />
          );
        })}
      </svg>
      
      {/* INSTRUCTION TEXT */}
      <div style={{
          position: 'absolute',
          bottom: '80px',
          width: '100%',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          color: '#666',
          fontSize: isMobile ? '12px' : '14px',
          opacity: Math.max(0, (progress - 0.8) * 5),
          pointerEvents: 'none'
      }}>
          Haz clic en cualquier círculo para ver la ley en detalle
      </div>

      {/* DETAIL CARD */}
      {selectedNode && (
        <div className="deputy-card" style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'white',
          padding: '32px 24px 48px',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.15)',
          zIndex: 100,
          maxWidth: '1000px',
          margin: '0 auto', 
          textAlign: 'center',
          borderTop: '1px solid #e5e7eb',
          animation: 'slide-up 0.3s ease-out',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          pointerEvents: 'auto'
        }}>
          {/* Close Button */}
          <button
            onClick={() => setSelectedNode(null)}
            style={{
              position: 'absolute',
              top: '20px', right: '20px',
              background: '#f3f4f6', border: 'none', borderRadius: '50%',
              width: '36px', height: '36px', fontSize: '18px',
              cursor: 'pointer', color: '#374151',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s'
            }}
          >✕</button>

          {/* Badge */}
          <div style={{
            backgroundColor: selectedNode.color,
            color: 'white',
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            marginBottom: '8px',
            letterSpacing: '0.05em'
          }}>
            {selectedNode.status}
          </div>

          {/* Title */}
          <h3 style={{
            margin: '0',
            fontFamily: 'var(--font-serif)',
            fontSize: isMobile ? '18px' : '22px',
            lineHeight: 1.3,
            color: '#111',
            maxWidth: '90%'
          }}>
            {selectedNode.titulo}
          </h3>

          {/* Metadata */}
          <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              justifyContent: 'center', 
              gap: '12px', 
              color: '#666',
              fontSize: '13px',
              marginTop: '4px'
          }}>
             <span><strong>Tipo:</strong> {selectedNode.tipo}</span>
             {selectedNode.data.fecha_presentacion && (
                 <span>• <strong>Presentada:</strong> {new Date(selectedNode.data.fecha_presentacion).toLocaleDateString()}</span>
             )}
              {selectedNode.data.autor && (
                 <span>• <strong>Autor:</strong> {selectedNode.data.autor}</span>
             )}
          </div>
        </div>
      )}
    </div>
  );
}
"""

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
    f.write(new_code)
    f.write('\\n')

print("Successfully truncated and replaced LegislativeSwarm component")
