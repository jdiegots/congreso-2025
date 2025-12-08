import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import seatsData from "./data/seats_data.json";
import diputadosData from "../public/data/diputados.json";
import gparData from "../public/data/gpar.json";
import partidosData from "../public/data/partidos.json";
import diputadosBajaData from "../public/data/diputados_baja.json";
import iniciativasData from "../public/data/iniciativas.json";

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

// Helper to parse /Date(...)/ format
function parseJsonDate(dateStr) {
  if (!dateStr) return null;
  const timestamp = parseInt(dateStr.replace(/\/Date\((.*?)\)\//, '$1'));
  return new Date(timestamp);
}

function HemicycleBackground({ colorsVisible, scrollProgress, exitProgress, onSeatClick, groupingCriteria, isMobile, viewportWidth, viewportHeight }) {
  const svgRef = useRef(null);
  const [flashActive, setFlashActive] = useState(false);
  const prevProgressRef = useRef(scrollProgress);

  const layoutConfig = useMemo(() => {
    const MARGIN_X = isMobile ? 24 : 80;
    const EFFECTIVE_WIDTH = seatsData.width - 2 * MARGIN_X;
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

  const { gparDesiredCols, gridCols } = layoutConfig;

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
          fullPartyName: fullPartyName,
          fullPartyName: fullPartyName,
          // Random Explosion Vector - Mainly horizontal split
          vx: (Math.random() < 0.5 ? -1 : 1) * (2000 + Math.random() * 3000), // Strong pull left or right
          vy: (Math.random() - 0.5) * 1000 // Slight vertical drift
        });
      }
    });
    return map;
  }, []);

  const { seats, groupLabels } = useMemo(() => {
    const groupLabelsData = [];
    // 1. Identify all circles (Regular + Extra)
    // 2. Separate Fixed vs Dynamic Seats
    // UPDATED: User request "Forget ministers... when movement starts... minister seats disappear".
    // "Referencia a los 2 ministros sin asiento eliminar".
    // Interpretation: 
    // - Remove 'extraData' logic (ministers without seats).
    // - Remove 'FixedGovMembers' logic.
    // - If they have a seat, they are just a seat. 
    // - "Asientos de los ministros tienen que desaparecer"? 
    //   If the user means "don't show them specially", we just treat them as normal deputies.
    //   But if they mean "Hide them completely", then we should filter them out?
    //   "cuando empiece el movimiento... los asientos de los ministros tienen que desaparecer".
    //   This likely means the "Fixed Government Line" idea is ABANDONED.
    //   And they should just be treated as normal deputies in their groups.
    //   OR does it mean they should NOT be shown at all in the groupings?
    //   "olvidarnos de los ministros ... eliminar referencia a ellos ... los asientos de los ministros tienen que desaparecer".

    // Most likely interpretation: Treat them exactly like any other deputy. 
    // If they have a seat, they are in the hemi-cycle. When we group, they go to their group.
    // The "ministers without seat" should be REMOVED entirely.

    // Step 1: Remove Extra Seats (Ministers without seat)
    // We already removed the creation of 'extraData' and 'extraSeats' in this block? No, need to remove lines 141-155.

    const baseSeats = seatsData.seats.map(s => ({ ...s, isExtra: false }));
    const combinedSeats = baseSeats.map((s, i) => ({ ...s, id: i }));

    // Step 2: No fixed members. All seats participate in schema.
    const fixedGovMembers = [];
    const schemaSeats = combinedSeats;

    // 3. Layout Calculation
    // 3. Layout Calculation
    const targetMap = new Map();
    // Spacing: Compact enough to fit in viewport, but distinct.
    const SPACING_Y = isMobile ? 44 : 46;
    const SUB_SPACING_X = isMobile ? 44 : 46;
    const GROUP_GAP = isMobile ? 100 : 80; // Enough for label
    // Start Y: Push down to avoid overlapping with top "Filter" buttons (approx 80px on screen -> ~350-400 SVG units)
    const START_Y = isMobile ? 380 : 120;

    const MOBILE_COL_GAP = 12;
    const DESKTOP_COL_GAP = 60; // Significant separation for desktop

    // Responsive Config
    const MARGIN_X = isMobile ? 40 : 80;

    // Fix: Use seatsData.width directly. Using viewportWidth in SVG coords caused items to be squeezed into a narrow column.
    const EFFECTIVE_WIDTH = seatsData.width - 2 * MARGIN_X;

    const OFFSET_X = (seatsData.width - EFFECTIVE_WIDTH) / 2;

    const getColWidth = (cols) => {
      const gap = isMobile ? MOBILE_COL_GAP : DESKTOP_COL_GAP;
      const totalGap = Math.max(0, (cols - 1) * gap);
      const width = (EFFECTIVE_WIDTH - totalGap) / cols;
      return { width, gap };
    };

    // A. Place Fixed Members
    // (Removed per request)
    const fixedHeight = 0;

    // B. Bucketing for Dynamic Seats (schemaSeats)
    const groups = {};
    const groupKeysSet = new Set();

    const getBucket = (seatId) => {
      const info = seatDeputyMap.get(seatId);
      if (!info) return null; // Skip empty seats

      if (groupingCriteria === 'g_par') {
        // Remove 'Gobierno' bucket if we want them to disappear, or just let them fall into 'Others'?
        // "olvidarnos de los ministros". 
        // If we map them to their group (PSOE/Sumar), they will appear in those groups.
        // If we want them to "disappear", we should return null or exclude them?
        // User says "cuando empiece el movimiento... los asientos de los ministros tienen que desaparecer".
        // This implies visual removal.
        // Let's assume for now we map them to 'Gobierno' but if we want to hide them, we might need to filter `schemaSeats`?
        // Wait, "asientos de ministros tienen que desaparecer" -> "Ministers have seats in GPar usually".
        // If they sit in the hemi-cycle, they are deputies.
        // If user wants to "forget ministers", maybe we just treat them as their GPar.
        // AND we DON'T create a specific "Gobierno" group.
        // So we map them to their party/group.

        // return info.g_par || 'Mixto';
        // But previously: if (info.gobierno === 1) return 'Gobierno';

        // CHANGE: Do NOT bucket by 'Gobierno'. Just bucket by g_par.
        return info.g_par || 'Mixto';
      } else if (groupingCriteria === 'partido') {
        const sigla = info.partido;
        if (sigla === 'IND') return 'Independiente';
        return sigla;
      } else if (groupingCriteria === 'circunscripcion') {
        return info.circunscripcion; // Return null/undefined if missing, skipping the group
      }
      return null;
    };

    schemaSeats.forEach(item => {
      const key = getBucket(item.id);
      if (!key) return; // Skip if no bucket (e.g. empty seat)
      if (!groups[key]) groups[key] = [];
      groups[key].push(item.id);
      groupKeysSet.add(key);
    });

    let sortedGroupKeys = Array.from(groupKeysSet).sort();

    // Sort Keys
    if (groupingCriteria === 'g_par') {
      // "Gobierno" removed from order as it is no longer a bucket
      const order = ["Popular en el Congreso", "Socialista", "Vox", "Plurinacional SUMAR", "Republicano", "Junts per Catalunya", "Euskal Herria Bildu", "Vasco (EAJ-PNV)", "Mixto"];
      sortedGroupKeys = order.filter(k => groupKeysSet.has(k));
      Array.from(groupKeysSet).forEach(k => { if (!sortedGroupKeys.includes(k)) sortedGroupKeys.push(k); });
    } else if (groupingCriteria === 'partido') {
      // Custom Sort Order to ensure correct painting order (top-to-bottom per column if possible, but mostly for finding them)
      // Actually, standard sort doesn't matter much if we force columns, but let's keep it clean.
      const customOrder = [
        "PP", // Col 1
        "PSOE", "PSC", // Col 2
        "VOX", "SUMAR", "CeC", "IU", "PODEMOS", "MM", "MÉS", // Col 3
        "UPN", "CCa", "Independiente", "Més-Compromís", "IPV", "CHA", // Col 4
        "JxCat", "EAJ-PNV", "EH Bildu", "ERC", "BNG" // Col 5
      ];

      sortedGroupKeys.sort((a, b) => {
        let ixA = customOrder.indexOf(a);
        let ixB = customOrder.indexOf(b);
        if (ixA === -1) ixA = 999;
        if (ixB === -1) ixB = 999;
        return ixA - ixB;
      });

    } else if (groupingCriteria === 'circunscripcion') {
      // Sort by number of deputies (descending), then name (ascending)
      sortedGroupKeys.sort((a, b) => {
        const countA = groups[a] ? groups[a].length : 0;
        const countB = groups[b] ? groups[b].length : 0;
        if (countA !== countB) return countB - countA;
        return a.localeCompare(b, 'es');
      });
    } else {
      sortedGroupKeys.sort((a, b) => a.localeCompare(b, 'es'));
    }

    // Pre-calculate party sizes for sorting
    const partyCounts = {};
    schemaSeats.forEach(s => {
      const info = seatDeputyMap.get(s.id);
      if (info && info.partido) {
        partyCounts[info.partido] = (partyCounts[info.partido] || 0) + 1;
      }
    });

    // Label Opacity Logic: Fade in between 90% and 100% of the transition.
    // AND Fade out QUICKLY during exit/explosion (gone by 20% of exit).
    const labelOpacity = Math.max(0, (scrollProgress - 0.9) * 10) * Math.max(0, 1 - exitProgress * 5);

    // C. Layout Dynamic Groups
    if (groupingCriteria === 'g_par') {
      if (isMobile) {
        // --- MOBILE ROW-BASED LAYOUT ---
        const seatsPerRow = Math.floor(EFFECTIVE_WIDTH / SUB_SPACING_X);
        // Start below the fixed members
        let currentY = START_Y + fixedHeight + (fixedGovMembers.length > 0 ? 20 : 0);

        const orderedGroups = ["Gobierno", "Popular en el Congreso", "Socialista", "Vox", "Plurinacional SUMAR", "Republicano", "Junts per Catalunya", "Euskal Herria Bildu", "Vasco (EAJ-PNV)", "Mixto"]
          .filter(name => groupKeysSet.has(name));

        orderedGroups.forEach(gName => {
          const ids = groups[gName] || [];
          if (ids.length === 0) return;

          // Sort IDS within Group
          // 1. Party Size (Desc)
          // 2. Party Name (Asc)
          // 3. Government Member (Desc: 1 first) - "subordena por miembro de gobierno"
          ids.sort((idA, idB) => {
            const infoA = seatDeputyMap.get(idA);
            const infoB = seatDeputyMap.get(idB);
            if (!infoA || !infoB) return 0;

            const pA = infoA.partido || "";
            const pB = infoB.partido || "";
            const sizeA = partyCounts[pA] || 0;
            const sizeB = partyCounts[pB] || 0;

            if (sizeA !== sizeB) return sizeB - sizeA; // Larger parties first
            if (pA !== pB) return pA.localeCompare(pB); // Alphabetical party

            // Same party: Govt members first?
            const govA = infoA.gobierno || 0;
            const govB = infoB.gobierno || 0;
            return govB - govA;
          });

          // Add Group Label - MOBILE
          groupLabelsData.push({
            id: `label-${gName}`,
            text: gName,
            x: OFFSET_X, // Align to left edge
            y: currentY - 40,
            opacity: labelOpacity,
            // Mobile SVG is scaled differently, needs larger font
            fontSize: '42px',
            anchor: 'start' // Left alignment
          });

          // Layout Seats
          const rows = Math.ceil(ids.length / seatsPerRow);
          const cx = OFFSET_X + EFFECTIVE_WIDTH / 2;

          ids.forEach((seatId, idx) => {
            const col = idx % seatsPerRow;
            const row = Math.floor(idx / seatsPerRow);
            const xOffset = (col - (seatsPerRow - 1) / 2) * SUB_SPACING_X;
            targetMap.set(seatId, { x: cx + xOffset, y: currentY + row * SPACING_Y });
          });

          currentY += rows * SPACING_Y + GROUP_GAP;
        });

      } else {
        // --- DESKTOP COLUMN LAYOUT (Optimized for full width) ---
        // Calculate max possible columns based on effective width and group sizes
        // We want to fill the space. 
        // Min column width ~ 200px? Or flexible?
        const MIN_COL_WIDTH = 200;
        const MAX_COLS = Math.floor(EFFECTIVE_WIDTH / MIN_COL_WIDTH);
        const desiredCols = Math.max(3, Math.min(8, MAX_COLS)); // Allow up to 8 columns

        const { width: colWidth, gap } = getColWidth(desiredCols);
        const columnHeights = new Array(desiredCols).fill(START_Y);
        // Column 0 reserved? No, stripped that logic. All equal.

        // Dynamic seat per row calculation to fill the column width nicely
        const seatsPerRow = Math.max(4, Math.floor(colWidth / SUB_SPACING_X));



        const orderedGroups = ["Popular en el Congreso", "Socialista", "Vox", "Plurinacional SUMAR", "Republicano", "Junts per Catalunya", "Euskal Herria Bildu", "Vasco (EAJ-PNV)", "Mixto"]
          .filter(name => groupKeysSet.has(name));

        const groupColMap = {};

        orderedGroups.forEach(gName => {
          const ids = groups[gName] || [];
          if (ids.length === 0) return;

          // Sort IDS within Group (Desktop) - SAME LOGIC
          ids.sort((idA, idB) => {
            const infoA = seatDeputyMap.get(idA);
            const infoB = seatDeputyMap.get(idB);
            if (!infoA || !infoB) return 0;

            const pA = infoA.partido || "";
            const pB = infoB.partido || "";
            const sizeA = partyCounts[pA] || 0;
            const sizeB = partyCounts[pB] || 0;

            if (sizeA !== sizeB) return sizeB - sizeA;
            if (pA !== pB) return pA.localeCompare(pB);

            const govA = infoA.gobierno || 0;
            const govB = infoB.gobierno || 0;
            return govB - govA;
          });

          // Distribute groups to the shortest column to balance height
          // EXCEPT: User wants "Plurinacional SUMAR" below "Vox".
          let colIndex;
          if (gName === 'Plurinacional SUMAR' && groupColMap['Vox'] !== undefined) {
            colIndex = groupColMap['Vox'];
          } else {
            colIndex = columnHeights.indexOf(Math.min(...columnHeights));
          }

          groupColMap[gName] = colIndex;

          let currentY = columnHeights[colIndex];
          const cx = OFFSET_X + (colIndex * (colWidth + gap)) + colWidth / 2;

          // Add Group Label - DESKTOP
          // Center label in the column
          const labelX = cx;
          const labelY = currentY;

          groupLabelsData.push({
            id: `label-${gName}`,
            text: gName,
            x: labelX,
            y: labelY,
            opacity: labelOpacity, // Fade in with scroll
            fontSize: '24px', // Standard desktop size
            anchor: 'middle'
          });

          // Push seats down to make room for label
          currentY += 50;

          ids.forEach((seatId, idx) => {
            const col = idx % seatsPerRow;
            const row = Math.floor(idx / seatsPerRow);
            const xOffset = (col - (seatsPerRow - 1) / 2) * SUB_SPACING_X;
            targetMap.set(seatId, { x: cx + xOffset, y: currentY + row * SPACING_Y });
          });

          columnHeights[colIndex] = currentY + Math.ceil(ids.length / seatsPerRow) * SPACING_Y + GROUP_GAP;
        });
      }
    } else {
      // Grid Strategy (Party / Circumscription)
      // Since user said "except when filtering by party... where they change too", 
      // we DON'T fix them here either. They just flow.

      const GRID_START_Y = START_Y + fixedHeight;

      const GRID_COLS = isMobile
        ? Math.max(3, Math.min(5, Math.floor(EFFECTIVE_WIDTH / 160)))
        : (groupingCriteria === 'partido' ? 5 : Math.min(6, Math.max(3, Math.floor(EFFECTIVE_WIDTH / 240)))); // Reduce cols for 'partido' to allow more gap

      // Custom Gap for Partido in Desktop
      let { width: colWidth, gap } = getColWidth(GRID_COLS);

      if (groupingCriteria === 'partido' && !isMobile) {
        // Force larger gap
        const PARTY_GAP = 100;
        const totalGap = Math.max(0, (GRID_COLS - 1) * PARTY_GAP);
        colWidth = (EFFECTIVE_WIDTH - totalGap) / GRID_COLS;
        gap = PARTY_GAP;
      }

      const columnY = new Array(GRID_COLS).fill(GRID_START_Y);

      // Seats per row: Adjust if colWidth changed
      const seatsPerRow = isMobile
        ? 4
        : Math.max(3, Math.floor(colWidth / SUB_SPACING_X));

      // Extra vertical gap for parties
      let CURRENT_GROUP_GAP = (groupingCriteria === 'partido' && !isMobile) ? GROUP_GAP + 60 : GROUP_GAP + 20;

      // Reduce spacing for Circunscripcion
      if (groupingCriteria === 'circunscripcion') {
        CURRENT_GROUP_GAP = 50; // Much smaller gap
      }

      // But user said "Fixed line... EXCEPT when filtered by party/region". 
      // So in Party/Region they are NOT fixed.
      // In Group mode (which we just handled above), they are the "Gobierno" group, which we place first.

      const groupGridColMap = {};

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

        // Determine Column
        let colIndex;
        // Custom Stacking for Party Mode
        // Col 1: PP
        // Col 2: PSOE, PSC
        // Col 3: Vox, Sumar, CeC, IU, Podemos, MM, MÉS
        // Col 4: UPN, CCa, Independiente, Més-Compromís, IPV, CHA
        // Col 5: JxCat, EAJ-PNV, EH Bildu, ERC, BNG

        if (groupingCriteria === 'partido') {
          const col2 = ["PSOE", "PSC"];
          const col3 = ["VOX", "SUMAR", "CeC", "IU", "PODEMOS", "MM", "MÉS"];
          const col4 = ["UPN", "CCa", "Independiente", "Més-Compromís", "IPV", "CHA"];
          const col5 = ["JxCat", "EAJ-PNV", "EH Bildu", "ERC", "BNG"];

          if (gName === "PP") colIndex = 0;
          else if (col2.includes(gName)) colIndex = 1;
          else if (col3.includes(gName)) colIndex = 2;
          else if (col4.includes(gName)) colIndex = 3;
          else if (col5.includes(gName)) colIndex = 4;
          else colIndex = 4; // Fallback
        }

        if (colIndex === undefined) {
          colIndex = columnY.indexOf(Math.min(...columnY));
        }

        groupGridColMap[gName] = colIndex;

        let currentY = columnY[colIndex];

        // Manual Adjustment: Pull closer if it's NOT the first item in the column
        if (groupingCriteria === 'partido') {
          // For each column, the first item (e.g. PSOE, Vox, UPN, JxCat) should NOT be pulled up.
          // Only subsequent items.
          const isFirstInCol = (
            (gName === "PP") ||
            (gName === "PSOE") ||
            (gName === "VOX") ||
            (gName === "UPN") ||
            (gName === "JxCat")
          );

          if (!isFirstInCol) {
            currentY -= isMobile ? 50 : 45;
          }
        }

        const cx = OFFSET_X + (colIndex * (colWidth + gap)) + colWidth / 2;

        // Add Label for Grid Groups (Party / Region)
        groupLabelsData.push({
          id: `label-${gName}`,
          text: gName,
          x: cx,
          y: currentY,
          opacity: labelOpacity,
          fontSize: isMobile ? '36px' : '20px', // Slightly smaller than main headers
          anchor: 'middle'
        });

        currentY += isMobile ? 60 : 40; // Space for label

        ids.forEach((seatId, idx) => {
          const c = idx % seatsPerRow;
          const r = Math.floor(idx / seatsPerRow);
          const xOffset = (c - (seatsPerRow - 1) / 2) * SUB_SPACING_X;
          targetMap.set(seatId, { x: cx + xOffset, y: currentY + r * SPACING_Y });
        });

        columnY[colIndex] = currentY + Math.ceil(ids.length / seatsPerRow) * SPACING_Y + CURRENT_GROUP_GAP;
      });
    }

    // (Logic moved to top of block)
    // Return Final Mapping
    const mappedSeats = combinedSeats.map((s) => {
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

      // LOGIC: Hide seats that are NOT in targetMap when scrolling implies they are not part of the grouped layout.
      // Or specifically for ministers as requested:
      // "Los ministros, exceptuando los que tienen grupo parlamentario, tienen que desaparecer."
      // Identify if this seat is a "minister without group".
      // We can use seatDeputyMap or check if it was bucketed.

      const info = seatDeputyMap.get(i);
      const isMinister = info && info.gobierno === 1;
      const hasGroup = info && info.g_par; // If g_par is present (not null/empty)

      // If scroll is active (layout changing or changed)
      if (scrollProgress > 0.1) {
        // If it's a minister WITHOUT group, hide them.
        if (isMinister && !hasGroup) {
          // Fade out quickly
          finalOpacity = Math.max(0, 1 - (scrollProgress - 0.1) * 5);
        }

        // Also standard hide for unmapped seats if any (like empty seats) is handled below?
        // Existing logic:
        if (!seatColorMap.has(i) && !s.isExtra) {
          // These illustrate "empty seats" usually?
          finalOpacity = Math.max(0, 1 - scrollProgress * 2);
        }
      }

      if (exitProgress > 0) {
        // Apply Explosion
        const info = seatDeputyMap.get(s.id);
        if (info) {
          finalX += info.vx * exitProgress;
          finalY += info.vy * exitProgress;
          // Re-enable fade out
          finalOpacity = finalOpacity * Math.max(0, 1 - exitProgress * 10);
        }
      }

      if (s.isExtra) {
        // Extras (ministers without seat) should also disappear if we strictly follow "Forget ministers"
        // But previously we filtered them out? 
        // If they remain in 'seats', hide them.
        finalOpacity = 0; // Just hide them always if we want them gone
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

    return { seats: mappedSeats, groupLabels: groupLabelsData };
  }, [colorsVisible, seatColorMap, scrollProgress, groupingCriteria, seatDeputyMap, isMobile, viewportWidth, exitProgress]);

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

    // --- CIRCLES ---
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
    // --- LABELS (Mobile only basically, but generic support) ---
    const labels = svg.selectAll(".group-label")
      .data(groupLabels, d => d.id);

    labels.enter()
      .append("text")
      .attr("class", "group-label")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", d => d.anchor || "middle") // Use dynamic anchor
      .attr("fill", "#111827") // Darker text for visibility
      .attr("font-size", d => d.fontSize || "24px") // Use per-item font size
      .attr("font-weight", 600) // Bold
      .attr("font-family", "var(--font-serif)") // Serif looks more official
      .style("pointer-events", "none") // Don't block clicks
      .text(d => d.text) // Set text content
      .attr("opacity", 0)
      .merge(labels)
      .transition()
      .duration(duration)
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", d => d.anchor || "middle") // Update anchor on transition too
      .attr("font-size", d => d.fontSize || "24px")
      .attr("opacity", d => d.opacity !== undefined ? d.opacity : 1)
      .text(d => d.text); // Update text just in case

    labels.exit().remove();
  }, [seats, groupLabels, flashActive, scrollProgress, onSeatClick, groupingCriteria]);

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hoveredDeputyIndex, setHoveredDeputyIndex] = useState(null); // Track hovered deputy image
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

  // Exit / Explosion Progress
  // Start later, end later, giving more space
  const exitStartY = 2000;
  const exitEndY = 3000;
  const exitProgress = Math.min(1, Math.max(0, (scrollY - exitStartY) / (exitEndY - exitStartY)));
  const uiOpacity = 1 - exitProgress * 10; // UI fades faster too (gone by 50%)

  // Departures Progress
  // Starts after Explosion finishes and "No todos" message has appeared.
  const departureStartY = 3500;
  // Much longer scroll to allow slow, delayed animations per item
  const departureEndY = 20000;
  const departureProgress = Math.min(1, Math.max(0, (scrollY - departureStartY) / (departureEndY - departureStartY)));

  const sortedDepartures = useMemo(() => {
    return [...diputadosBajaData].sort((a, b) => {
      const dateA = parseJsonDate(a.fecha_baja);
      const dateB = parseJsonDate(b.fecha_baja);
      return dateA - dateB;
    });
  }, []);

  const approvedStats = useMemo(() => {
    let counts = { leyes: 0, reales: 0, organicas: 0 };
    iniciativasData.forEach(d => {
      const title = (d.titulo || "").trim();
      if (d.tipo === "Leyes") counts.leyes++;
      else if (d.tipo === "Reales decretos" && title.startsWith("Real Decreto-ley")) counts.reales++;
      else if (d.tipo === "Leyes organicas" && title.startsWith("Ley Orgánica")) counts.organicas++;
    });

    // Use same palette/colors or specific ones
    return [
      { label: "Leyes", count: counts.leyes, color: "#111" },
      { label: "Reales decretos", count: counts.reales, color: "#333" },
      { label: "Leyes orgánicas", count: counts.organicas, color: "#555" }
    ];
  }, []);

  const approvedCount = useMemo(() => approvedStats.reduce((acc, curr) => acc + curr.count, 0), [approvedStats]);

  // Initiatives Section Progress
  const initStartY = 20000; // Starts right where departures end
  const initEndY = 26000;
  const initProgressRaw = Math.max(0, (scrollY - initStartY) / (initEndY - initStartY));
  const initProgress = Math.min(1, initProgressRaw);




  return (
    <div className="app-container">
      <div className="hero-page">
        <HemicycleBackground
          colorsVisible={colorsVisible}
          scrollProgress={scrollProgress}
          exitProgress={exitProgress}
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
          opacity: (scrollProgress > 0.98 ? 1 : 0) * uiOpacity,
          pointerEvents: (scrollProgress > 0.98 && uiOpacity > 0.1) ? 'auto' : 'none',
          transition: 'opacity 0.2s',
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
      <div style={{ height: "50000px" }} className="scroll-section">
        <div
          className="nyt-info-box"
          style={{
            opacity: (scrollY > 350 && scrollY < 800 ? 1 : 0) * uiOpacity,
            transform: scrollY > 350 ? 'translateY(0)' : 'translateY(20px)',
            pointerEvents: scrollY > 350 && scrollY < 800 ? 'auto' : 'none'
          }}
        >
          350 diputados y 18 ministros sin acta ocupan sus escaños
        </div>

        <div
          className={`search-section ${scrollY > 1600 ? 'is-visible' : ''}`}
          style={{
            opacity: (scrollY > 1600 ? 1 : 0) * uiOpacity,
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

        {/* Final Message */}
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          // Show during explosion (exitProgress > 0.3)
          // Hide QUICKLY when departures start (departureProgress > 0)
          // Gone by 0.05 to clear way for line
          opacity: Math.min(1, Math.max(0, (exitProgress - 0.3) * 5)) * Math.max(0, 1 - departureProgress * 20),
          pointerEvents: (exitProgress > 0.3 && departureProgress < 0.05) ? 'auto' : 'none',
          zIndex: 60,
          fontFamily: 'var(--font-serif)',
          color: '#111',
          width: '90%',
          maxWidth: '300px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          alignItems: 'center'
        }}>
          <h2 style={{
            fontSize: isMobile ? '32px' : '48px',
            lineHeight: 1.1,
            fontWeight: 700,
            margin: 0
          }}>
            No todos los que empezaron en enero terminan 2025 como diputado
          </h2>
        </div>

        {/* DEPARTURES SECTION */}
        <div style={{
          position: 'fixed',
          top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 50
        }}>
          {/* Timeline Line */}
          <div style={{
            position: 'absolute',
            left: '50%',
            bottom: '0',
            width: '2px',
            height: '100%',
            backgroundColor: '#ccc', // Subtle timeline
            transformOrigin: 'bottom',
            // Faster: Fills in first 20% (approx 4000px of scroll)
            transform: `scaleY(${Math.min(1, departureProgress * 5)})`,
            // Fade out at the very end (last 5% of scroll)
            opacity: departureProgress > 0.78 ? (1 - (departureProgress - 0.78) * 20) : 1,
            transition: 'transform 0.1s linear, opacity 0.5s',
            zIndex: 49
          }} />

          {/* Intro Text */}
          <div style={{
            position: 'absolute',
            right: isMobile ? '20px' : '10%',
            // Move up with the line. Line is full at p=0.2.
            bottom: `${departureProgress * 500}%`,
            // Offset slightly to be "behind" the head of the line or to the side properly
            marginBottom: '-20px',
            width: isMobile ? '150px' : '200px',
            textAlign: 'right',
            fontFamily: 'var(--font-serif)',
            fontSize: isMobile ? '14px' : '18px',
            lineHeight: 1.4,
            color: '#666',
            // Appear a bit after line starts (0.01)
            // Fade out smoothly starting at 0.15, gone by 0.18
            opacity: Math.max(0, Math.min(1, (departureProgress - 0.01) * 10)) * Math.max(0, 1 - (departureProgress - 0.01) * 2),
            // Removed transition on 'bottom' to prevent jitter with scroll updates
            transition: 'opacity 0.2s',
            zIndex: 48
          }}>
            Estos fueron los 10 diputados que causaron baja durante 2025
          </div>

          {sortedDepartures.map((d, i) => {
            // Continuous Timeline Logic
            const spacing = 1200; // Distance between items

            // We want the list to start entering approx when progress > 0.22 (Right after text gone)

            const totalScrollDistance = 20000;
            // At p=0.22, currentScroll = 4400.
            // We want Start Item (i=0) to be at Y=0.
            // startOffset ~= 4400.
            // Add buffer to come from bottom: 5000.
            const startOffset = 5000;

            const currentScroll = departureProgress * totalScrollDistance;

            // Calculate Y position relative to center of screen
            // Initially (progress=0), Item 0 is at 2000px (below screen).
            // As we scroll, it moves up.
            // We center it relative to the viewport center (vh/2).
            const itemY = startOffset + i * spacing - currentScroll;

            // Only render if roughly on screen (optimization)
            if (itemY < -1000 || itemY > 2000) return null;

            // Alternating Layout
            const isLeft = i % 2 === 0;
            const formatName = (n) => {
              if (!n) return '';
              if (n.includes(',')) {
                const [sur, first] = n.split(',');
                return `${first.trim()} ${sur.trim()}`;
              }
              return n;
            };

            return (
              <div key={i} style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, ${itemY}px)`, // Move physically
                width: '90%',
                maxWidth: '900px',
                display: 'flex',
                flexDirection: 'column', // Stack vertically
                // Align entire block to left or right
                alignItems: isLeft ? 'flex-start' : 'flex-end',
                justifyContent: 'center',
                gap: isMobile ? '16px' : '24px',
                textAlign: (isLeft ? 'left' : 'right'),
                zIndex: 51
              }}>
                {/* Image Section */}
                <div style={{
                  display: 'flex',
                  justifyContent: (isLeft ? 'flex-start' : 'flex-end'),
                  width: '100%'
                }}>
                  {/* Wrapper for Floating Animation */}
                  <div style={{
                    position: 'relative',
                    // Move sizing and positioning here
                    height: isMobile ? '140px' : '350px',
                    marginLeft: (() => {
                      if (d.nombre.includes('Guijarro')) return isMobile ? '0' : '-80px';
                      if (d.nombre.includes('Casares')) return isMobile ? '-40px' : '-140px';
                      if (d.nombre.includes('Herranz')) return isMobile ? '-50px' : '-150px';
                      return (isLeft && isMobile) ? '-10px' : '0';
                    })(),
                    marginRight: (() => {
                      if (d.nombre.includes('Cerdán')) return isMobile ? '-33px' : '-80px'; // Santos: Less right-pull
                      if (d.nombre.includes('Esteban')) return isMobile ? '-10px' : '-100px';
                      if (d.nombre.includes('Ayala')) return isMobile ? '0' : '-100px';
                      return (!isLeft) ? (isMobile ? '-50px' : '-250px') : '0';
                    })(),
                    // Apply omnidirectional float here
                    animation: `float-subtle ${7 + (i % 4)}s ease-in-out infinite`,
                    animationDelay: `${i * 1.1}s` // Desynced
                  }}>
                    <img
                      src={`images/${d.imagen}.png`}
                      alt={d.nombre}
                      onMouseEnter={() => setHoveredDeputyIndex(i)}
                      onMouseLeave={() => setHoveredDeputyIndex(null)}
                      style={{
                        height: '100%',
                        width: 'auto',
                        objectFit: 'contain',
                        // React to hover: Scale up slightly and tilt
                        transform: hoveredDeputyIndex === i ? 'scale(1.08) rotate(2deg)' : 'scale(1) rotate(0deg)',
                        transition: 'transform 0.4s cubic-bezier(0.25, 1.5, 0.5, 1)', // Bouncy transition
                        cursor: 'pointer'
                      }}
                    />
                  </div>
                </div>

                {/* Text Container */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isMobile ? '4px' : '8px',
                  // Items align same side as the block
                  alignItems: (isLeft ? 'flex-start' : 'flex-end'),
                  maxWidth: isMobile ? '45%' : '400px',
                  // Santos Special: Bring text closer to image (Right side item -> Text is on left of image -> Move text Right)
                  transform: d.nombre.includes('Cerdán') ? (isMobile ? 'translateY(-30px)' : 'translateY(-60px)') : 'none'
                }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: isMobile ? '18px' : '24px', color: '#111', fontFamily: 'var(--font-serif)', lineHeight: 1.1 }}>
                      {formatName(d.nombre)}
                    </h3>
                    <p style={{ margin: 0, color: '#666', fontSize: isMobile ? '11px' : '15px', textTransform: 'uppercase', fontWeight: 600 }}>
                      {d.partido} <span style={{ opacity: 0.5 }}>|</span> {d.circunscripcion}
                    </p>
                  </div>

                  <div style={{ fontSize: isMobile ? '13px' : '16px', color: '#111', fontWeight: 500 }}>
                    Baja el {parseJsonDate(d.fecha_baja).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>

                  <div style={{ width: '40px', height: '2px', background: '#e5e7eb', margin: isMobile ? '4px 0' : '8px 0' }} />

                  <p style={{ margin: 0, fontSize: isMobile ? '14px' : '18px', lineHeight: 1.4, color: '#333', fontFamily: 'var(--font-serif)' }}>
                    {d.causa_baja}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Stats Section (Appears after line is gone) */}
          {
            (() => {
              // Stats Logic
              // Appear after line fades (0.83). safe start 0.85.
              // Animate counters from 0.85 to 0.95.
              const startStats = 0.85;
              const endStats = 1.0;

              let statsOpacity = 0;
              if (departureProgress > startStats) {
                statsOpacity = Math.min(1, (departureProgress - startStats) * 10); // Fade in over 0.1
                // Fade out at the very end, slightly after counters finish (0.97 to 1.0)
                if (departureProgress > 0.97) {
                  statsOpacity *= Math.max(0, 1 - (departureProgress - 0.97) * 33);
                }
              }

              // Counter Progress (0 to 1)
              const countP = Math.min(1, Math.max(0, (departureProgress - startStats) / 0.1));

              // Counters
              const countSesiones = Math.floor(countP * 76);
              const countVotaciones = Math.floor(countP * 48);

              return (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  fontFamily: 'var(--font-serif)',
                  color: '#111',
                  opacity: statsOpacity,
                  zIndex: 50,
                  width: '90%',
                  maxWidth: '800px',
                  pointerEvents: statsOpacity > 0 ? 'auto' : 'none'
                }}>
                  <div style={{ fontSize: isMobile ? '28px' : '48px', lineHeight: 1.2, marginBottom: '20px' }}>
                    Este 2025 se celebraron <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'inline-block', minWidth: '2ch', textAlign: 'center' }}>{countSesiones}</span> sesiones plenarias.
                  </div>
                  <div style={{ fontSize: isMobile ? '28px' : '48px', lineHeight: 1.2, color: '#444' }}>
                    En <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'inline-block', minWidth: '2ch', textAlign: 'center' }}>{countVotaciones}</span> de ellas hubo votaciones.
                  </div>
                </div>
              );
            })()
          }

          {/* Initiatives Visualization */}
          {(() => {
            const showInit = initProgress > 0;
            if (!showInit) return null;

            const opacity = Math.min(1, initProgress * 5);
            const approvedMax = Math.max(...approvedStats.map(d => d.count));

            return (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '90%',
                maxWidth: '1000px',
                height: '600px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 52,
                opacity,
                pointerEvents: opacity > 0 ? 'auto' : 'none'
              }}>
                <div style={{ position: 'relative', width: '100%', marginBottom: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <h2 style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: isMobile ? '24px' : '36px',
                    fontWeight: 700,
                    margin: 0,
                    textAlign: 'center',
                    color: '#111',
                    opacity
                  }}>
                    Se aprobaron un total de
                  </h2>

                  <div style={{
                    marginTop: '12px',
                    fontFamily: 'var(--font-serif)',
                    fontSize: isMobile ? '32px' : '54px',
                    color: '#111',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '12px'
                  }}>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{approvedCount}</span>
                    <span style={{ fontSize: isMobile ? '18px' : '24px', fontWeight: 400 }}>iniciativas legislativas</span>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  gap: isMobile ? '20px' : '60px',
                  height: '100%',
                  width: '100%'
                }}>
                  {approvedStats.map((d) => {
                    const barHeight = approvedMax > 0 ? (d.count / approvedMax) * (isMobile ? 250 : 400) : 0;

                    return (
                      <div key={d.label} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        height: '100%'
                      }}>
                        <div style={{
                          fontFamily: 'var(--font-serif)',
                          fontSize: isMobile ? '24px' : '48px',
                          fontWeight: 700,
                          marginBottom: '12px',
                          color: d.color,
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {d.count}
                        </div>

                        <div style={{
                          width: isMobile ? '60px' : '100px',
                          height: `${Math.max(4, barHeight)}px`,
                          position: 'relative',
                          transformOrigin: 'bottom',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                          borderRadius: '8px 8px 0 0',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: d.color
                          }} />
                        </div>

                        <div style={{
                          marginTop: '16px',
                          textAlign: 'center',
                          fontFamily: 'var(--font-sans)',
                          fontSize: isMobile ? '12px' : '16px',
                          fontWeight: 500,
                          color: '#666',
                          maxWidth: isMobile ? '100px' : '160px',
                          lineHeight: 1.2
                        }}>
                          {d.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        </div>

        <div style={{ height: '42000px', width: '1px', flexShrink: 0 }} />
      </div>
    </div>
  );
}
