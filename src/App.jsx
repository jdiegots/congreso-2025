import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import seatsData from "./data/seats_data.json";
import diputadosData from "../public/data/diputados.json";
import gparData from "../public/data/gpar.json";
import partidosData from "../public/data/partidos.json";

// Helper to format "Surname, Name" -> "Name Surname"
function formatName(rawName) {
  if (!rawName) return "";
  const parts = rawName.split(",").map(s => s.trim());
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return rawName;
}

// Helper to get virtual Seat ID for deputies without seat
function getVirtualSeatId(deputyId) {
  return 10000 + deputyId;
}

function HemicycleBackground({ colorsVisible, scrollProgress, onSeatClick, groupingCriteria, isMobile, viewportWidth, viewportHeight }) {
  const svgRef = useRef(null);
  const [flashActive, setFlashActive] = useState(false);
  const prevProgressRef = useRef(scrollProgress);

  const layoutConfig = useMemo(() => {
    const MARGIN_X = isMobile ? 24 : 80;
    const EFFECTIVE_WIDTH = Math.min(
      seatsData.width - 2 * MARGIN_X,
      viewportWidth ? viewportWidth * (isMobile ? 0.96 : 0.9) : seatsData.width - 2 * MARGIN_X
    );
    const OFFSET_X = (seatsData.width - EFFECTIVE_WIDTH) / 2;

    const gparDesiredCols = groupingCriteria === 'g_par'
      ? (isMobile
        ? Math.max(3, Math.min(4, Math.floor(EFFECTIVE_WIDTH / 180)))
        : Math.min(5, Math.max(3, Math.floor(EFFECTIVE_WIDTH / 260))))
      : null;

    const gridCols = groupingCriteria !== 'g_par'
      ? (isMobile
        ? Math.max(3, Math.min(5, Math.floor(EFFECTIVE_WIDTH / 180)))
        : Math.min(6, Math.max(3, Math.floor(EFFECTIVE_WIDTH / 240))))
      : null;

    return { MARGIN_X, EFFECTIVE_WIDTH, OFFSET_X, gparDesiredCols, gridCols };
  }, [groupingCriteria, isMobile, viewportWidth]);

  useEffect(() => {
    // Check if we just completed organization (crossed 0.98 threshold)
    if (scrollProgress >= 0.98 && prevProgressRef.current < 0.98) {
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 600);
    }
    prevProgressRef.current = scrollProgress;
  }, [scrollProgress]);

  // Pre-process Data: Map Seat ID -> { initialColor, finalColor }
  const seatColorMap = useMemo(() => {
    const map = new Map();

    // 1. Create LOOKUPs
    const gparColors = {};
    gparData.forEach(p => {
      let c = p.color;
      if (typeof c === 'number') c = c.toString();
      if (c && !c.startsWith('#')) c = '#' + c;
      gparColors[p.g_par] = c;
    });

    const partidoColors = {};
    partidosData.forEach(p => {
      let c = p.color;
      if (typeof c === 'number') c = c.toString();
      if (c && !c.startsWith('#')) c = '#' + c;
      partidoColors[p.siglas] = c;
    });

    // 2. Map Seat -> Colors (Include extras)
    const allDeputies = [...diputadosData];
    // Helper to identify extras
    const isExtra = (d) => d.gobierno === 1 && !d.asiento;

    allDeputies.forEach(d => {
      const seatId = d.asiento ? d.asiento : (isExtra(d) ? getVirtualSeatId(d.id) : null);
      if (!seatId) return;

      let initC = "#666";
      let finalC = "#666";

      // Initial: GPar or Gov special
      if (!d.g_par && d.gobierno === 1) {
        initC = '#324670';
      } else if (d.g_par && gparColors[d.g_par]) {
        initC = gparColors[d.g_par];
      }

      // Final: Party Color
      if (d.partido && partidoColors[d.partido]) {
        finalC = partidoColors[d.partido];
      } else {
        finalC = initC;
      }

      map.set(seatId, { initial: initC, final: finalC });
    });

    return map;
  }, []);

  // Pre-process Data: Map Seat ID -> Deputy Info (for click)
  const seatDeputyMap = useMemo(() => {
    const map = new Map();
    // Lookup for full party names
    const partyNames = {};
    partidosData.forEach(p => {
      partyNames[p.siglas] = p.nombre;
    });

    // Helper to identify extras
    const isExtra = (d) => d.gobierno === 1 && !d.asiento;

    diputadosData.forEach(d => {
      const seatId = d.asiento ? d.asiento : (isExtra(d) ? getVirtualSeatId(d.id) : null);
      if (seatId) {
        const fullPartyName = partyNames[d.partido] || d.partido || "";
        map.set(seatId, {
          ...d,
          formattedName: formatName(d.nombre),
          fullPartyName: fullPartyName
        });
      }
    });
    return map;
  }, []);

  const seats = useMemo(() => {
    // 1. Identify all circles (Regular + Extra)
    const extraData = diputadosData.filter(d => d.gobierno === 1 && !d.asiento);
    // Base seats from seatsData
    const baseSeats = seatsData.seats.map(s => ({ ...s, isExtra: false }));
    // Extra seats
    const extraSeats = extraData.map(d => ({
      id: getVirtualSeatId(d.id),
      x: seatsData.width / 2,
      y: 2000,
      r: 5,
      isExtra: true
    }));

    const combinedSeats = [
      ...baseSeats.map((s, i) => ({ ...s, id: i })),
      ...extraSeats
    ];

    // 2. Separate Fixed vs Dynamic Seats
    // Fixed: Gov=1 and No GPar (Seated or Extra) including those added as extras
    const fixedGovMembers = combinedSeats.filter(s => {
      const info = seatDeputyMap.get(s.id);
      // We want all Gov members who DO NOT belong to a parliamentary party (g_par is null or empty)
      // OR simply all Gov members? User said "Los ministros... tengan o no asientos... Si en gobierno pone 1, y no tienen g_par (null), se quedan ahí."
      return info && info.gobierno === 1 && !info.g_par;
    });
    const fixedIds = new Set(fixedGovMembers.map(s => s.id));
    const schemaSeats = combinedSeats.filter(s => !fixedIds.has(s.id));

    // 3. Layout Calculation
    const targetMap = new Map();
    const SPACING_Y = isMobile ? 28 : 36;
    const SUB_SPACING_X = isMobile ? 26 : 36;
    const GROUP_GAP = isMobile ? 48 : 80;
    const START_Y = isMobile ? 80 : 120;

    // Responsive Config
    const MARGIN_X = isMobile ? 40 : 80;
    const EFFECTIVE_WIDTH = Math.min(
      seatsData.width - 2 * MARGIN_X,
      viewportWidth ? viewportWidth * (isMobile ? 0.92 : 0.9) : seatsData.width - 2 * MARGIN_X
    );
    const OFFSET_X = (seatsData.width - EFFECTIVE_WIDTH) / 2;

    // A. Place Fixed Members (Always Top Left of Gov Col)
    const effectiveCols = gparDesiredCols || gridCols || (isMobile ? 3 : 5);
    const govColWidth = EFFECTIVE_WIDTH / effectiveCols;
    const fixedCx = OFFSET_X + govColWidth / 2;

    fixedGovMembers.sort((a, b) => a.id - b.id);
    fixedGovMembers.forEach((s, idx) => {
      const COLS = isMobile ? 3 : 4;
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const xOffset = (col - (COLS - 1) / 2) * SUB_SPACING_X;
      targetMap.set(s.id, {
        x: fixedCx + xOffset,
        y: START_Y + row * SPACING_Y
      });
    });

    // Calculate vertical space used by fixed members
    const fixedRows = Math.ceil(fixedGovMembers.length / (isMobile ? 3 : 4));
    const fixedHeight = fixedRows * SPACING_Y + (fixedGovMembers.length > 0 ? (isMobile ? 48 : 40) : 0);

    // B. Bucketing for Dynamic Seats (schemaSeats)
    const groups = {};
    const groupKeysSet = new Set();

    const getBucket = (seatId) => {
      const info = seatDeputyMap.get(seatId);
      if (!info) return 'Otros';

      if (groupingCriteria === 'g_par') {
        if (info.gobierno === 1) return 'Gobierno';
        return info.g_par || 'Mixto';
      } else if (groupingCriteria === 'partido') {
        return (info.fullPartyName || info.partido) || 'Otros';
      } else if (groupingCriteria === 'circunscripcion') {
        return info.circunscripcion || 'Desconocida';
      }
      return 'Otros';
    };

    schemaSeats.forEach(item => {
      const key = getBucket(item.id);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item.id);
      groupKeysSet.add(key);
    });

    let sortedGroupKeys = Array.from(groupKeysSet).sort();

    // Sort Keys
    if (groupingCriteria === 'g_par') {
      const order = ["Gobierno", "Popular en el Congreso", "Socialista", "Vox", "Plurinacional SUMAR", "Republicano", "Junts per Catalunya", "Euskal Herria Bildu", "Vasco (EAJ-PNV)", "Mixto"];
      sortedGroupKeys = order.filter(k => groupKeysSet.has(k));
      Array.from(groupKeysSet).forEach(k => { if (!sortedGroupKeys.includes(k)) sortedGroupKeys.push(k); });
    } else if (groupingCriteria === 'partido') {
      sortedGroupKeys.sort((a, b) => groups[b].length - groups[a].length);
    } else {
      sortedGroupKeys.sort((a, b) => a.localeCompare(b, 'es'));
    }

    // C. Layout Dynamic Groups
    if (groupingCriteria === 'g_par') {
      const desiredCols = isMobile ? 2 : Math.min(5, Math.max(3, Math.floor(EFFECTIVE_WIDTH / 260)));
      const colWidth = EFFECTIVE_WIDTH / desiredCols;
      const columnHeights = new Array(desiredCols).fill(START_Y);
      // Column 0 reserves vertical space for fixed Gobierno members
      columnHeights[0] = START_Y + fixedHeight;

      const seatsPerRow = isMobile ? 3 : Math.min(6, Math.max(4, Math.floor(EFFECTIVE_WIDTH / 220)));

      const orderedGroups = ["Gobierno", "Popular en el Congreso", "Socialista", "Vox", "Plurinacional SUMAR", "Republicano", "Junts per Catalunya", "Euskal Herria Bildu", "Vasco (EAJ-PNV)", "Mixto"]
        .filter(name => groupKeysSet.has(name));

      orderedGroups.forEach(gName => {
        const ids = groups[gName] || [];
        if (ids.length === 0) return;

        // Gobierno always in the first column to align with fixed ministers
        const colIndex = gName === 'Gobierno'
          ? 0
          : columnHeights.slice(1).reduce((minIdx, _, idx) => {
              const absoluteIdx = idx + 1;
              return columnHeights[absoluteIdx] < columnHeights[minIdx] ? absoluteIdx : minIdx;
            }, 1);

        let currentY = columnHeights[colIndex];
        const cx = OFFSET_X + (colIndex * colWidth) + colWidth / 2;

        ids.forEach((seatId, idx) => {
          const col = idx % seatsPerRow;
          const row = Math.floor(idx / seatsPerRow);
          const xOffset = (col - (seatsPerRow - 1) / 2) * SUB_SPACING_X;
          targetMap.set(seatId, { x: cx + xOffset, y: currentY + row * SPACING_Y });
        });

        columnHeights[colIndex] = currentY + Math.ceil(ids.length / seatsPerRow) * SPACING_Y + GROUP_GAP;
      });
    } else {
      // Grid Strategy
      // Shift entire grid DOWN to avoid fixed members in Top-Left (which overlaps with Grid Col 0)
      const GRID_START_Y = START_Y + fixedHeight + 40;

      const GRID_COLS = isMobile ? 2 : Math.min(6, Math.max(3, Math.floor(EFFECTIVE_WIDTH / 240)));
      const colWidth = EFFECTIVE_WIDTH / GRID_COLS;
      const columnY = new Array(GRID_COLS).fill(GRID_START_Y);

      const seatsPerRow = isMobile ? 3 : Math.min(6, Math.max(4, Math.floor(EFFECTIVE_WIDTH / 220)));

      sortedGroupKeys.forEach((gName) => {
        const ids = groups[gName];

        // Sub-sorting
        if (groupingCriteria === 'circunscripcion') {
          const gParOrder = ["Gobierno", "Socialista", "Popular en el Congreso", "Vox", "Plurinacional SUMAR"];
          ids.sort((a, b) => {
            const dA = seatDeputyMap.get(a);
            const dB = seatDeputyMap.get(b);
            const gA = dA ? (dA.g_par || "") : "";
            const gB = dB ? (dB.g_par || "") : "";
            let ixA = gParOrder.indexOf(gA);
            let ixB = gParOrder.indexOf(gB);
            if (ixA === -1) ixA = 999;
            if (ixB === -1) ixB = 999;
            if (ixA !== ixB) return ixA - ixB;
            return gA.localeCompare(gB);
          });
        }

        const colIndex = columnY.indexOf(Math.min(...columnY));
        let currentY = columnY[colIndex];
        const cx = OFFSET_X + (colIndex * colWidth) + colWidth / 2;

        ids.forEach((seatId, idx) => {
          const c = idx % seatsPerRow;
          const r = Math.floor(idx / seatsPerRow);
          const xOffset = (c - (seatsPerRow - 1) / 2) * SUB_SPACING_X;
          targetMap.set(seatId, { x: cx + xOffset, y: currentY + r * SPACING_Y });
        });

        columnY[colIndex] = currentY + Math.ceil(ids.length / seatsPerRow) * SPACING_Y + GROUP_GAP + 20;
      });
    }

    // (Logic moved to top of block)
    // Return Final Mapping
    return combinedSeats.map((s) => {
      const i = s.id;
      let baseColor = "#666";
      let targetColor = "#666";

      // Fix Radius for Extras
      let r = s.isExtra ? 15.78 : (s.r || 15.78);

      // Safety check if s.r comes from JSON properly
      if (!s.isExtra && !s.r) r = 15.78;

      if (colorsVisible) {
        const colorData = seatColorMap.get(i);
        if (colorData) {
          baseColor = colorData.initial;
          targetColor = colorData.final;
        }
      }

      if (scrollProgress > 0 && baseColor !== targetColor) {
        baseColor = d3.interpolateRgb(baseColor, targetColor)(scrollProgress);
      }

      let finalX = s.x;
      let finalY = s.y;
      let initialX = s.x;
      let initialY = s.y;

      if (s.isExtra) {
        initialX = seatsData.width / 2;
        initialY = 2000;
        if (scrollProgress === 0) {
          finalY = initialY;
        }
      }

      const t = targetMap.get(i);
      if (t) {
        const ease = d3.easeCubicInOut(scrollProgress);
        finalX = initialX + (t.x - initialX) * ease;
        finalY = initialY + (t.y - initialY) * ease;
      }

      let finalOpacity = 1;
      if (!seatColorMap.has(i) && !s.isExtra && scrollProgress > 0) {
        finalOpacity = Math.max(0, 1 - scrollProgress * 2);
      }
      if (s.isExtra) {
        finalOpacity = Math.max(0, (scrollProgress - 0.5) * 2);
      }

      return {
        id: i,
        x: finalX,
        y: finalY,
        r: r, // Use corrected radius
        opacity: finalOpacity,
        color: baseColor,
      };
    });
  }, [colorsVisible, seatColorMap, scrollProgress, groupingCriteria, seatDeputyMap, isMobile, viewportWidth]);

  // Track previous grouping to trigger animation
  const prevGroupingRef = useRef(groupingCriteria);
  const lastChangeRef = useRef(0);

  // Render loop
  useEffect(() => {
    if (!svgRef.current) return;

    // Detect grouping change
    const isGroupingChange = prevGroupingRef.current !== groupingCriteria;
    const now = Date.now();

    if (isGroupingChange) {
      prevGroupingRef.current = groupingCriteria;
      lastChangeRef.current = now;
    }

    // Determine duration: 
    // 1. If it IS a change -> 600ms
    // 2. If it was a change very recently (handle StrictMode double-fire) -> 600ms
    const timeSinceChange = now - lastChangeRef.current;

    // Animate if change happened recently. 
    // We remove the scroll check because controls are only visible when scrolled anyway.
    const shouldAnimate = isGroupingChange || timeSinceChange < 200;
    const duration = shouldAnimate ? 600 : 0;

    const svg = d3.select(svgRef.current);
    const circles = svg
      .selectAll("circle")
      .data(seats, d => d.id);

    // ENTER
    const enter = circles.enter()
      .append("circle")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => d.r || 15) // Default to 15 (match JSON roughly)
      .attr("fill", "#666")
      .attr("opacity", 0.8)
      .attr("class", "seat-circle")
      .style("pointer-events", "all");

    // UPDATE
    circles.merge(enter)
      .style("cursor", scrollProgress >= 0.95 ? "pointer" : "default")
      .classed("flash-effect", flashActive)
      .on("click", (event, d) => {
        event.stopPropagation();
        if (scrollProgress >= 0.95 && onSeatClick) {
          onSeatClick(d.id);
        }
      })
      .transition()
      .duration(duration)
      .ease(d3.easeCubicOut)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => d.r)
      .attr("fill", (d) => d.color)
      .attr("opacity", (d) => d.opacity !== undefined ? d.opacity : 1);

    // EXIT
    circles.exit().remove();
    svg.selectAll("text").remove();
  }, [seats, flashActive, scrollProgress, onSeatClick, groupingCriteria]);

  const baseViewBoxHeight = useMemo(() => {
    const minHeight = isMobile ? 2400 : 1800;
    if (!viewportHeight) return minHeight;
    return Math.max(minHeight, viewportHeight * 1.2);
  }, [isMobile, viewportHeight]);

  // Dynamically expand the viewBox to avoid clipping when groups grow vertically
  const viewBoxHeight = useMemo(() => {
    if (!seats || seats.length === 0) return baseViewBoxHeight;
    const maxY = seats.reduce((max, seat) => {
      const y = (seat?.y || 0) + (seat?.r || 0);
      return y > max ? y : max;
    }, 0);
    return Math.max(baseViewBoxHeight, maxY + 80);
  }, [seats, baseViewBoxHeight]);

  return (
    <svg
      ref={svgRef}
      className="hero-bg-svg"
      style={{
        opacity: colorsVisible ? 1 : 0.22,
        transition: "opacity 0.5s ease-in-out"
      }}
      viewBox={`0 0 ${seatsData.width} ${viewBoxHeight}`}
      aria-hidden="true"
      preserveAspectRatio="xMidYMin meet"
    />
  );
}

// Helper hook for window size
function useWindowSize() {
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return windowSize;
}

export default function App() {
  const [scrollY, setScrollY] = useState(0);
  const [selectedDeputy, setSelectedDeputy] = useState(null);
  const [groupingCriteria, setGroupingCriteria] = useState('g_par');

  const size = useWindowSize();
  const isMobile = size.width < 1024;

  // ... rest of component


  // Helper to lookup deputy data by seat ID
  const getDeputyData = (seatId) => {
    const isExtra = (d) => d.gobierno === 1 && !d.asiento;

    // Look for deputy
    let found = diputadosData.find(d => d.asiento === seatId);
    if (!found) {
      // Try to find extra by virtual ID
      if (seatId >= 10000) {
        found = diputadosData.find(d => getVirtualSeatId(d.id) === seatId);
      }
    }

    if (!found) return null;

    // Quick lookup for party name
    const pData = partidosData.find(p => p.siglas === found.partido);
    const fullPartyName = pData ? pData.nombre : found.partido;

    return {
      ...found,
      formattedName: formatName(found.nombre),
      fullPartyName: fullPartyName
    };
  };

  const handleSeatClick = (seatId) => {
    const dep = getDeputyData(seatId);
    setSelectedDeputy(dep);
  };

  useEffect(() => {
    if (selectedDeputy) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedDeputy]);

  useEffect(() => {
    let targetY = window.scrollY;
    let currentY = window.scrollY;
    let rafId = null;

    const updateScroll = () => {
      const diff = targetY - currentY;
      if (Math.abs(diff) < 0.5) {
        currentY = targetY;
        setScrollY(currentY);
        rafId = null;
        return;
      }
      currentY += diff * 0.08;
      setScrollY(currentY);
      rafId = requestAnimationFrame(updateScroll);
    };

    const handleScroll = () => {
      targetY = window.scrollY;
      if (!rafId) {
        rafId = requestAnimationFrame(updateScroll);
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const colorsVisible = scrollY > 200;
  const progress = Math.min(1, Math.max(0, scrollY / 300));

  const cloudStyle = {
    opacity: 1 - progress,
    filter: `blur(${progress * 8}px)`,
    transform: `scale(${1 + progress * 0.15})`,
    pointerEvents: progress > 0.9 ? 'none' : 'auto',
    transition: 'opacity 0.1s, filter 0.1s, transform 0.1s linear',
  };

  const scrollHintOpacity = Math.max(0, 1 - scrollY / 100);

  // Calculate interpolation factor (0 to 1) between scrollY 400 and 1500
  const startY = 400;
  const endY = 1500;
  const scrollProgress = Math.min(1, Math.max(0, (scrollY - startY) / (endY - startY)));



  return (
    <div className="app-container">
      <div className="hero-page">
        <HemicycleBackground
          colorsVisible={colorsVisible}
          scrollProgress={scrollProgress}
          onSeatClick={handleSeatClick}
          groupingCriteria={groupingCriteria}
          isMobile={isMobile}
          viewportWidth={size.width}
          viewportHeight={size.height}
        />

        {/* FILTER CONTROLS */}
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '24px',
          opacity: scrollProgress > 0.98 ? 1 : 0,
          pointerEvents: scrollProgress > 0.98 ? 'auto' : 'none',
          transition: 'opacity 0.5s',
          zIndex: 40,
          backgroundColor: 'rgba(255,255,255,0.9)',
          padding: '8px 16px',
          borderRadius: '20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginRight: '4px' }}>AGRUPAR POR:</span>
          <button
            onClick={() => setGroupingCriteria('g_par')}
            style={{
              background: groupingCriteria === 'g_par' ? '#111' : '#eee',
              color: groupingCriteria === 'g_par' ? '#fff' : '#333',
              border: 'none', padding: '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500
            }}>Grupo</button>
          <button
            onClick={() => setGroupingCriteria('partido')}
            style={{
              background: groupingCriteria === 'partido' ? '#111' : '#eee',
              color: groupingCriteria === 'partido' ? '#fff' : '#333',
              border: 'none', padding: '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500
            }}>Partido</button>
          <button
            onClick={() => setGroupingCriteria('circunscripcion')}
            style={{
              background: groupingCriteria === 'circunscripcion' ? '#111' : '#eee',
              color: groupingCriteria === 'circunscripcion' ? '#fff' : '#333',
              border: 'none', padding: '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500
            }}>Circunscripción</button>
        </div>

        {selectedDeputy && (
          <div className="deputy-card" style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'white',
            padding: '32px 24px 48px',
            borderTopLeftRadius: '24px',
            borderTopRightRadius: '24px',
            boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)',
            zIndex: 100,
            maxWidth: '100%',
            textAlign: 'center',
            borderTop: '1px solid #e5e7eb',
            animation: 'slide-up 0.3s ease-out',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <style>{`
              @keyframes slide-up {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
              }
            `}</style>
            <button
              onClick={() => setSelectedDeputy(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: '#f3f4f6',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '16px',
                cursor: 'pointer',
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              aria-label="Cerrar"
            >
              ✕
            </button>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '28px', margin: '0 0 8px', color: '#111' }}>
              {selectedDeputy.formattedName}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <p style={{ margin: 0, color: '#4b5563', fontSize: '16px' }}>
                Diputado por <strong>{selectedDeputy.circunscripcion}</strong>
              </p>
              <p style={{ margin: 0, color: '#111827', fontWeight: 500, fontSize: '16px' }}>
                {selectedDeputy.fullPartyName}
              </p>
              <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Grupo Parlamentario {selectedDeputy.g_par}
              </p>
            </div>
          </div>
        )}

        {/* Overlay to close */}
        {selectedDeputy && (
          <div
            onClick={() => setSelectedDeputy(null)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.2)',
              zIndex: 90
            }}
          />
        )}
        <div className="hero-inner">
          <div className="hero-centered">
            <header className="hero-content" style={cloudStyle}>
              <h1 className="hero-title animate-enter">El hemiciclo</h1>
              <p className="hero-dek animate-enter delay-1">
                Un análisis visual de la sede de la soberanía nacional
              </p>
              <p className="hero-credits animate-enter delay-2">
                Descubre la distribución de los 350 diputados y el equilibrio
                visual por cómo se movió la política española dentro del hemiciclo.
              </p>

              <p className="hero-credits animate-enter delay-3">
                Por <strong>J. Diego Quevedo</strong>
              </p>
              <div
                className="scroll-hint animate-enter delay-4"
                style={{ opacity: scrollHintOpacity }}
              >
                <span className="scroll-text">Desliza hacia abajo para comenzar</span>
                <div className="scroll-icon">↓</div>
              </div>
            </header>
          </div>
        </div>
      </div>
      <div style={{ height: "300vh" }} className="scroll-section">
        <div
          className="nyt-info-box"
          style={{
            opacity: scrollY > 350 && scrollY < 800 ? 1 : 0,
            transform: scrollY > 350 ? 'translateY(0)' : 'translateY(20px)',
            pointerEvents: scrollY > 350 && scrollY < 800 ? 'auto' : 'none'
          }}
        >
          350 diputados y 18 ministros sin acta ocupan sus escaños
        </div>

        <div
          className={`search-section ${scrollY > 1600 ? 'is-visible' : ''}`}
          style={{
            opacity: scrollY > 1600 ? 1 : 0,
            pointerEvents: scrollY > 1600 ? 'auto' : 'none'
          }}
        >
          <h2 className="search-header">
            Conoce a los diputados
          </h2>
          <input
            type="text"
            className="search-input"
            placeholder="Buscar diputado..."
          />
        </div>
      </div>
    </div>
  );
}
