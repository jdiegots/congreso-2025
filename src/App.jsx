import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import seatsData from "./data/seats_data.json";
import diputadosData from "../public/data/diputados.json";
import gparData from "../public/data/gpar.json";
import partidosData from "../public/data/partidos.json";
import diputadosBajaData from "../public/data/diputados_baja.json";
import iniciativasData from "../public/data/iniciativas.json";
import InitiativesTable from "./components/InitiativesTable";
import DeputiesTable from "./components/DeputiesTable";

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

// Helper for legislative types
const isLegislative = (type) => {
  const t = (type || "").toLowerCase();
  if (t.includes("real decreto") || t.includes("reales decretos")) return "Reales decretos";
  if (t.includes("orgánica")) return "Leyes orgánicas";
  if (t.includes("ley")) return "Leyes ordinarias";
  return null;
};

// Helper to parse /Date(...)/ format
function parseJsonDate(dateStr) {
  if (!dateStr) return null;
  const timestamp = parseInt(dateStr.replace(/\/Date\((.*?)\)\//, '$1'));
  return new Date(timestamp);
}

// Search Logic Helpers
function normalizeStr(str) {
  return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

function searchDeputies(query, deputies, interventionsMap, limit = 3) {
  if (!query || query.trim().length === 0) return [];
  const qNorm = normalizeStr(query);
  const qTokens = qNorm.split(/\s+/).filter(t => t.length > 0);

  return deputies
    .filter(d => d.g_par && d.g_par.trim().length > 0)
    .map(d => {
      let score = 0;
      const nameNorm = normalizeStr(d.nombre);
      const partsOriginal = nameNorm.split(/[\s,]+/);

      let matchesAllTokens = true;

      qTokens.forEach(token => {
        let maxTokenScore = 0;
        let tokenFound = false;

        partsOriginal.forEach((part, index) => {
          let partScore = 0;
          if (part === token) partScore = 30;
          else if (part.startsWith(token)) partScore = 20;
          else if (part.includes(token)) partScore = 5;

          if (partScore > 0) {
            if (index === 0) partScore += 10; // Surname priority
            if (partScore > maxTokenScore) maxTokenScore = partScore;
            tokenFound = true;
          }
        });

        if (!tokenFound) {
          // check matches in other fields if needed, or penalize
          matchesAllTokens = false;
        }

        score += maxTokenScore;
      });

      if (!matchesAllTokens) return { d, score: 0 };

      // Relevance signals
      const intsCount = interventionsMap[d.nombre] || 0;
      score += Math.min(20, intsCount / 10);

      if (d.gobierno == 1) score += 20;

      return { d, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.d);
}

function HemicycleBackground({ colorsVisible, scrollProgress, exitProgress, onSeatClick, groupingCriteria, isMobile, viewportWidth, viewportHeight, interventionsMap }) {
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
    /* Flash removed as requested
    if (scrollProgress >= 0.98 && prevProgressRef.current < 0.98) {
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 600);
    }
    */
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
      const seatId = d.asiento ? parseInt(d.asiento, 10) : (isExtra(d) ? getVirtualSeatId(d.id) : null);
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
      const seatId = d.asiento ? parseInt(d.asiento, 10) : (isExtra(d) ? getVirtualSeatId(d.id) : null);
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

        // CHANGE: If they don't have g_par, DO NOT put them in Mixto. Return null so they remain unmapped and fade out.
        if (!info.g_par) return null;
        return info.g_par;
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

            if (govA !== govB) return govB - govA;

            // Sort by interventions
            const intA = interventionsMap[infoA.nombre] || 0;
            const intB = interventionsMap[infoB.nombre] || 0;
            return intB - intA;
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

            if (govA !== govB) return govB - govA;

            // Sort by interventions
            const intA = interventionsMap[infoA.nombre] || 0;
            const intB = interventionsMap[infoB.nombre] || 0;
            return intB - intA;
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
          // Calculate party counts WITHIN this constituency
          const localPartyCounts = {};
          ids.forEach(id => {
            const info = seatDeputyMap.get(id);
            if (info && info.partido) {
              localPartyCounts[info.partido] = (localPartyCounts[info.partido] || 0) + 1;
            }
          });

          ids.sort((a, b) => {
            const dA = seatDeputyMap.get(a);
            const dB = seatDeputyMap.get(b);
            const pA = dA ? (dA.partido || "") : "";
            const pB = dB ? (dB.partido || "") : "";

            // 1. Party Size within Constituency (Desc)
            const sizeA = localPartyCounts[pA] || 0;
            const sizeB = localPartyCounts[pB] || 0;
            if (sizeA !== sizeB) return sizeB - sizeA;

            // 1.5. If counts are tied, sort by Party Name to keep them grouped
            if (pA !== pB) return pA.localeCompare(pB);

            // 2. Government Member (Desc)
            const govA = dA ? (dA.gobierno || 0) : 0;
            const govB = dB ? (dB.gobierno || 0) : 0;
            if (govA !== govB) return govB - govA;

            // 3. Intervention Time (Desc)
            const intA = interventionsMap[dA.nombre] || 0;
            const intB = interventionsMap[dB.nombre] || 0;
            return intB - intA;
          });
        } else if (groupingCriteria === 'partido') {
          // Sort by Government (1) then Interventions (Desc)
          ids.sort((a, b) => {
            const dA = seatDeputyMap.get(a);
            const dB = seatDeputyMap.get(b);

            // 1. Government Member (Desc)
            const govA = dA ? (dA.gobierno || 0) : 0;
            const govB = dB ? (dB.gobierno || 0) : 0;
            if (govA !== govB) return govB - govA;

            // 2. Intervention Time (Desc)
            const intA = interventionsMap[dA.nombre] || 0;
            const intB = interventionsMap[dB.nombre] || 0;
            return intB - intA;
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
      // Fix: gobierno is string "1" in JSON
      const isMinister = info && (info.gobierno == 1);
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
  }, [colorsVisible, seatColorMap, scrollProgress, groupingCriteria, seatDeputyMap, isMobile, viewportWidth, exitProgress, interventionsMap]);

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
      // .classed("flash-effect", flashActive) // Removed
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
        filter: colorsVisible ? 'blur(0px)' : 'blur(4px)',
        transition: "opacity 0.5s ease-in-out, filter 0.5s ease-in-out"
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


// ... (existing helper functions remain)

export default function App() {
  const [view, setView] = useState('story'); // 'story' | 'database'
  const [scrollY, setScrollY] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hoveredDeputyIndex, setHoveredDeputyIndex] = useState(null); // Track hovered deputy image
  const [selectedDeputy, setSelectedDeputy] = useState(null);
  const [groupingCriteria, setGroupingCriteria] = useState('g_par');

  // Save previous scroll position to restore it when returning from sub-pages
  const prevScrollY = useRef(0);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleViewChange = (newView) => {
    if (view === 'story' && newView !== 'story') {
      prevScrollY.current = window.scrollY;
    }
    if (newView === 'story') {
      setIsRestoring(true);
    }
    setView(newView);
  };

  useLayoutEffect(() => {
    if (view === 'story' && prevScrollY.current > 0) {
      window.scrollTo({ top: prevScrollY.current, behavior: 'instant' });
      // Small timeout to ensure paint happens after scroll
      requestAnimationFrame(() => {
        setIsRestoring(false);
      });
    } else {
      setIsRestoring(false);
    }
  }, [view]);

  // Stats state
  const [votesByDeputy, setVotesByDeputy] = useState({});
  const [interventionsMap, setInterventionsMap] = useState({}); // Map Name -> Total Minutes
  const [abstentionLeaders, setAbstentionLeaders] = useState([]);

  // Search State
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Moved up to be available for effects
  const size = useWindowSize();
  const isMobile = size.width < 1024;



  // Story View Effect Logic 
  useEffect(() => {
    const results = searchDeputies(searchTerm, diputadosData, interventionsMap, isMobile ? 5 : 3);
    setSearchResults(results);
  }, [searchTerm, interventionsMap, isMobile]);


  useEffect(() => {
    // Optimization: Load pre-calculated stats instead of parsing raw CSV
    d3.json("/data/out_votaciones/stats_diputados.json").then(map => {
      setVotesByDeputy(map);

      // Calculate Abstention Leaders
      const leaders = [];
      Object.keys(map).forEach(key => {
        const stats = map[key];
        if (stats.abs > 0) {
          const dep = diputadosData.find(d => String(d.id) === key);
          if (dep) {
            leaders.push({ ...dep, count: stats.abs });
          }
        }
      });
      // Sort by count desc
      leaders.sort((a, b) => b.count - a.count);

      // Filter only the absolute max (ties included)
      if (leaders.length > 0) {
        const maxCount = leaders[0].count;
        const topLeaders = leaders.filter(l => l.count === maxCount);
        setAbstentionLeaders(topLeaders);
      } else {
        setAbstentionLeaders([]);
      }
    }).catch(e => console.error("Could not load stats:", e));



    // NEW: Load interventions
    d3.csv("/data/intervenciones_con_grupo.csv").then(rows => {
      const map = {};
      rows.forEach(r => {
        const orator = (r.ORADOR || "").trim();
        if (!orator) return;

        // Parse DURACION "H:MM"
        const dur = r.DURACION || "0:00";
        const parts = dur.split(':');
        let minutes = 0;
        if (parts.length === 2) {
          minutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        } else {
          // Fallback or ignore
        }

        if (!map[orator]) map[orator] = 0;
        map[orator] += minutes;
      });
      setInterventionsMap(map);
    }).catch(e => console.error("Error loading interventions:", e));

  }, []);

  // NEW: Load all legislative votes for the Swarm visualization
  const [allVotes, setAllVotes] = useState([]);
  useEffect(() => {
    d3.csv("/data/out_votaciones/votaciones.csv").then(rows => {
      setAllVotes(rows);
    }).catch(e => console.error("Error loading votaciones.csv:", e));
  }, []);

  // Pre-calculate Swarm Data to prevent lag on mount
  const swarmData = useMemo(() => {
    if (!iniciativasData) return { nodes: [], categories: [] };

    // Define Categories and Colors
    const categoryConfig = {
      "Aprobadas": { color: "#2F855A", label: "Aprobadas" },
      "Rechazadas": { color: "#C53030", label: "Rechazadas" },
      "En trámite": { color: "#3182CE", label: "En trámite" },
      "Retiradas": { color: "#718096", label: "Retiradas" },
      "Decaídas": { color: "#D69E2E", label: "Decaídas" }
    };
    const catKeys = ["Aprobadas", "En trámite", "Rechazadas", "Retiradas", "Decaídas"];

    const processed = [];

    iniciativasData.forEach(ini => {
      let status = null;
      const result = (ini.resultado_tramitacion || "").trim();
      const situacion = (ini.situacion_actual || "").trim();
      const tipo = (ini.tipo || "").trim();
      const titulo = (ini.titulo || "").trim();
      const tituloLower = titulo.toLowerCase();

      if (result === "Aprobado") {
        const isValidType = ["Leyes", "Proposición de ley", "Proyecto de ley"].includes(tipo);
        const startsWithRD = tituloLower.startsWith("real decreto-ley");
        const startsWithLO = tituloLower.startsWith("ley orgánica") || tituloLower.startsWith("ley organica");
        if (isValidType || startsWithRD || startsWithLO) {
          status = "Aprobadas";
        } else {
          return;
        }
      }
      else if (result === "Rechazado") status = "Rechazadas";
      else if (result === "Retirado") status = "Retiradas";
      else if (result === "Decaido" || result === "Decaído") status = "Decaídas";
      else if (situacion !== "Cerrado" && situacion !== "" && situacion !== null) status = "En trámite";

      if (!status) return;

      if (status !== "Aprobadas") {
        const normalizedType = isLegislative(ini.tipo);
        if (!normalizedType) return;
      }
      const normalizedType = isLegislative(ini.tipo) || "Otras";

      const cleanTitle = tituloLower.replace(/\s+/g, ' ').trim();

      // EXCLUSIONS
      if (cleanTitle.includes("ley 2/2025, de 29 de abril, por la que se modifican el texto refundido de la ley del estatuto de los trabajadores")) return;
      if (cleanTitle.includes("ley orgánica 1/2025, de 2 de enero, de medidas en materia de eficiencia del servicio público de justicia")) return;

      // USER REQUEST: EXCLUDE Ley 1/2025 desperdicio alimentario
      if (cleanTitle.includes("ley 1/2025") && cleanTitle.includes("desperdicio alimentario")) return;

      // OVERRIDES & NOTES
      let resultOverride = null;
      let customNote = null;

      if (cleanTitle.includes("ley 5/2025, de 24 de julio, por la que se modifican el texto refundido de la ley sobre responsabilidad civil y seguro en la circulación de vehículos a motor")) {
        resultOverride = "Aprobada en la Comisión de Economía, Comercio y Transformación Digital con competencia legislativa plena";
      }

      // USER REQUEST: Ley 7/2025 Salud Pública
      if (cleanTitle.includes("ley 7/2025") && cleanTitle.includes("salud pública")) {
        resultOverride = "Aprobada en la Comisión de Sanidad con competencia legislativa plena";
      }

      // USER REQUEST: Ley 6/2025 Canarias
      if (cleanTitle.includes("ley 6/2025") && cleanTitle.includes("canarias")) {
        resultOverride = "Aprobada en la Comisión de Hacienda y Función Pública con competencia legislativa plena";
      }

      // USER REQUEST: RDL 7/2025
      if (cleanTitle.includes("real decreto-ley 7/2025") && cleanTitle.includes("sistema eléctrico")) {
        customNote = "Derogado por el Congreso de los Diputados en Pleno el 22 de julio de 2025";
      }

      let vote = null;

      // MATCHING LOGIC
      if (cleanTitle.includes("estatuto de roma") && cleanTitle.includes("ratificación")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("votación de conjunto del texto del proyecto de ley orgánica por la que se autoriza la ratificación de cuatro enmiendas al artículo 8.2 del estatuto de roma"));
      }
      // USER REQUEST: Ley 9/2025 Movilidad
      else if (cleanTitle.includes("ley 9/2025") && cleanTitle.includes("movilidad sostenible")) {
        customNote = "Publicado el 4 de diciembre de 2025 tras las votaciones de enmiendas del Senado en Pleno el 13 de noviembre de 2025";
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("votación del dictamen del proyecto de ley de movilidad"));
      }
      // USER REQUEST: Ley Orgánica 3/2025 Derecho de Asociación
      else if (cleanTitle.includes("ley orgánica 3/2025") && cleanTitle.includes("asociación")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley orgánica por la que se modifica la ley orgánica 1/2002, de 22 de marzo, reguladora del derecho de asociación"));
      }
      // USER REQUEST: Ley 4/2025 Navarra
      else if (cleanTitle.includes("ley 4/2025") && cleanTitle.includes("navarra")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("votación de conjunto del texto del proyecto de ley por la que se modifica la ley 28/1990"));
      }
      // USER REQUEST: Ley 8/2025 Navegación Aérea
      else if (cleanTitle.includes("ley 8/2025") && cleanTitle.includes("navegación aérea")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("votación del dictamen del proyecto de ley por la que se modifican la ley 48/1960"));
      }
      // USER REQUEST: Proposición Ley Orgánica 4/2000 (Inmigración/VOX)
      else if (cleanTitle.includes("ley orgánica 4/2000") && cleanTitle.includes("inmigrantes ilegales")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario vox, orgánica de modificación de la ley orgánica 4/2000"));
      }
      // USER REQUEST: Escolarización necesidades especiales
      else if (cleanTitle.includes("escolarización del alumnado") && cleanTitle.includes("necesidades educativas especiales")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario popular en el congreso, relativa a la escolarización del alumnado con necesidades educativas especiales"));
      }
      // USER REQUEST: Proposición Ley Orgánica 5/2000 (Menores/VOX)
      else if (cleanTitle.includes("ley orgánica 5/2000") && cleanTitle.includes("menores")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario vox, orgánica por la que se modifica la ley orgánica 5/2000"));
      }
      // USER REQUEST: Matrimonio forzado (VOX)
      else if (cleanTitle.includes("matrimonio forzado") && cleanTitle.includes("código penal")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario vox, orgánica de modificación de la ley orgánica 10/1995, de 23 de noviembre, del código penal, para el endurecimiento de las penas del delito de matrimonio forzado"));
      }
      // USER REQUEST: Narcotráfico / Combustibles (VOX)
      else if (cleanTitle.includes("combustibles líquidos") && cleanTitle.includes("narcotráfico")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario vox, orgánica por la que se modifica la ley orgánica 10/1995, de 23 de noviembre, del código penal, al objeto de tipificar penalmente el transporte y almacenamiento de combustibles líquidos predeterminados al narcotráfico"));
      }
      // USER REQUEST: Servicios públicos / Municipios rurales (PP)
      else if (cleanTitle.includes("municipios rurales") && cleanTitle.includes("emergencia")) {
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("proposición de ley del grupo parlamentario popular en el congreso, para garantizar la prestación de los servicios públicos esenciales a los municipios rurales de pequeño tamaño en situaciones de emergencia de interés nacional"));
      }
      // USER REQUEST: Jornada laboral 37.5 horas / Desconexión
      else if (cleanTitle.includes("jornada ordinaria de trabajo") && cleanTitle.includes("desconexión")) {
        // Matching "Votación conjunta de las enmiendas a la totalidad de devolución al Proyecto de Ley..."
        vote = allVotes.find(v => (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim().includes("votación conjunta de las enmiendas a la totalidad de devolución al proyecto de ley para la reducción de la duración máxima de la jornada ordinaria de trabajo"));
      }
      else {
        // 1. Exact Match (All occurrences)
        let matches = allVotes.filter(v => {
          if (!cleanTitle) return false;
          const vText = (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim();
          return vText.includes(cleanTitle);
        });

        // 2. Loose Match (Common prefixes removed)
        if (matches.length === 0) {
          // Remove common legislative prefixes to find core subject
          const coreTitle = cleanTitle
            .replace(/proposición de ley/g, "")
            .replace(/proyecto de ley/g, "")
            .replace(/orgánica/g, "")
            .replace(/para la/g, "")
            .replace(/por la que se/g, "")
            .replace(/\s+/g, " ")
            .trim();

          if (coreTitle.length > 15) {
            matches = allVotes.filter(v => {
              const vText = (v.texto_expediente || "").toLowerCase().replace(/\s+/g, ' ').trim();
              return vText.includes(coreTitle);
            });
          }
        }

        // If multiple matches, take the last one
        if (matches.length > 0) {
          vote = matches[matches.length - 1];
        }
      }

      processed.push({
        id: ini.id || Math.random(),
        titulo: ini.titulo,
        tipo: normalizedType,
        status: status,
        color: categoryConfig[status].color,
        data: ini,
        resultOverride: resultOverride,
        customNote: customNote,
        voteData: vote ? {
          si: parseInt(vote.a_favor) || 0,
          no: parseInt(vote.en_contra) || 0,
          abs: parseInt(vote.abstenciones) || 0,
          nv: parseInt(vote.no_votan) || 0
        } : null,
        x: size.width / 2 + (Math.random() - 0.5) * 50,
        y: size.height / 2 + (Math.random() - 0.5) * 50,
        r: isMobile ? 3 : 4.5
      });
    });

    // SIMULATIONS
    const simulationCloud = d3.forceSimulation(processed)
      .force("charge", d3.forceManyBody().strength(isMobile ? -1 : -2))
      .force("center", d3.forceCenter(size.width / 2, size.height / 2))
      // Add radial force to constrain the cloud size, especially on mobile
      .force("radial", d3.forceRadial(isMobile ? 60 : 150, size.width / 2, size.height / 2).strength(isMobile ? 0.4 : 0.1))
      .force("collide", d3.forceCollide(d => d.r + (isMobile ? 0.5 : 1)))
      .stop();
    for (let i = 0; i < 150; i++) simulationCloud.tick();
    processed.forEach(n => { n.cloudX = n.x; n.cloudY = n.y; });

    const colWidth = size.width / catKeys.length;
    const simulationCluster = d3.forceSimulation(processed)
      .force("x", d3.forceX(d => {
        const idx = catKeys.indexOf(d.status);
        return (idx + 0.5) * colWidth;
      }).strength(0.8))
      .force("y", d3.forceY(size.height / 2).strength(0.2))
      .force("collide", d3.forceCollide(d => d.r + 1))
      .stop();
    for (let i = 0; i < 150; i++) simulationCluster.tick();
    processed.forEach(n => { n.clusterX = n.x; n.clusterY = n.y; });

    return { nodes: processed, categories: catKeys };
  }, [iniciativasData, size.width, size.height, isMobile, allVotes]);



  // Helper to lookup deputy data by seat ID
  const getDeputyData = (seatId) => {
    const isExtra = (d) => d.gobierno === 1 && !d.asiento;

    // Look for deputy
    let found = diputadosData.find(d => d.asiento == seatId);
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
    // Only run scroll loop in story view
    if (view !== 'story') return;

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
    // Initialize
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [view]);

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
  // Reduced for mobile (12000 vs 24500 pixels duration)
  const departureEndY = isMobile ? 15500 : 28000;
  const departureProgress = Math.min(1, Math.max(0, (scrollY - departureStartY) / (departureEndY - departureStartY)));

  const sortedDepartures = useMemo(() => {
    return [...diputadosBajaData].sort((a, b) => {
      if (!a.fecha_baja) return 1;
      if (!b.fecha_baja) return -1;
      const dateA = parseJsonDate(a.fecha_baja);
      const dateB = parseJsonDate(b.fecha_baja);
      return dateA - dateB;
    });
  }, []);

  const initiativesCounts = useMemo(() => {
    const counts = {
      proposicion: 0,
      reforma: 0,
      proyecto: 0
    };

    const propBreakdown = {};

    iniciativasData.forEach(i => {
      const t = i.tipo.trim();
      const status = i.situacion_actual || "Desconocido";

      if (t === "Proposición de ley") {
        counts.proposicion++;
        let key = status;
        if (status.includes("Enmienda")) key = "Enmiendas";

        // Clean up key if needed or group "Caducado"? User only said Enmienda.
        // Let's trim
        key = key.trim();

        if (!propBreakdown[key]) propBreakdown[key] = 0;
        propBreakdown[key]++;
      }
      else if (t === "Propuesta de reforma de Estatuto de Autonomía") counts.reforma++;
      else if (t === "Proyecto de ley") counts.proyecto++;
    });

    // Process breakdown into array
    // Colors palette
    const palette = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#64748b"];
    const breakdown = Object.entries(propBreakdown)
      .sort((a, b) => b[1] - a[1]) // Sort by count desc
      .map((entry, i) => ({
        label: entry[0],
        count: entry[1],
        color: palette[i % palette.length]
      }));

    return [
      {
        label: "Proposiciones de ley",
        count: counts.proposicion,
        color: "#080808ff",
        breakdown: breakdown
      },
      { label: "Proyectos de ley", count: counts.proyecto, color: "#505050ff" },
      { label: "Reforma de Estatuto", count: counts.reforma, color: "#ccccccff" }
    ];
  }, []);

  const approvedStats = useMemo(() => {
    const leyesCount = iniciativasData.filter(d => d.tipo === "Leyes").length;

    // Filter Reales decretos -> Title must start with "Real Decreto-ley"
    const realesCount = iniciativasData.filter(d =>
      d.tipo === "Reales decretos" && (d.titulo || "").startsWith("Real Decreto-ley")
    ).length;

    // Filter Leyes organicas -> Title must start with "Ley Orgánica" (to avoid 'Proyectos' etc if misclassification happens)
    const organicasCount = iniciativasData.filter(d =>
      (d.tipo === "Leyes organicas" || d.tipo === "Leyes orgánicas") && (d.titulo || "").startsWith("Ley Orgánica")
    ).length;

    return [
      { label: "Leyes", count: leyesCount, color: "#111" },
      { label: "Reales decretos", count: realesCount, color: "#505050" },
      { label: "Leyes orgánicas", count: organicasCount, color: "#cccccc" }
    ];
  }, []);

  const approvedCount = useMemo(() => approvedStats.reduce((acc, curr) => acc + curr.count, 0), [approvedStats]);

  const projectCount = useMemo(() => iniciativasData.filter(d => d.tipo === "Proyecto de ley").length, []);
  const maxCount = useMemo(() => Math.max(...initiativesCounts.map(d => d.count)), [initiativesCounts]);

  // Phase 1: Initial bars (Proposiciones, Proyectos, Reforma)
  // Initiatives bars animation progress
  // Stats phase: 
  // 0.85-0.92: Counters count up to 100%
  // 0.88-0.90: Fade out
  // 0.90+: Bars grow (extended range for linear growth)
  const barsStartProgress = 0.95; // Bars start appearing after stats fade
  const barsEndProgress = 1.0; // Bars reach 100% at end (0.10 range)
  const barsOpacity = departureProgress >= barsStartProgress
    ? Math.min(1, (departureProgress - barsStartProgress) / (barsEndProgress - barsStartProgress))
    : 0;

  // Bar growth progress: grows from 0 to 1, but we extend the actual scroll range
  // by using a wider departureProgress range mapping
  // departureProgress 0.90-1.0 maps to barsProgress 0-1, but we need MORE granularity
  // Solution: use a smaller end value to stretch the range
  const barsGrowthProgress = departureProgress >= 0.95
    ? Math.min(1, (departureProgress - 0.95) / (1.0 - 0.95))
    : 0;

  // Use barsGrowthProgress for the counter and bar height
  const barsProgress = barsOpacity > 0 ? barsGrowthProgress : 0;

  // Vertical movement: bars move UP as scroll continues AFTER they appear
  // They should move from bottom to top smoothly
  // Start moving up when bars are fully visible (departureProgress >= 1.0, which means scrolling past departure section)
  // Vertical movement: bars move UP as scroll continues AFTER they appear
  // They should move from bottom to top smoothly
  // Start moving up when bars are fully visible (departureProgress >= 1.0, which means scrolling past departure section)
  const barsVerticalStart = departureEndY - 1000; // Start moving when bars fully visible
  const barsVerticalRange = 5000; // Distance to move up over this scroll range
  const barsVerticalProgress = Math.max(0, (scrollY - barsVerticalStart) / barsVerticalRange);
  const barsVerticalOffset = barsVerticalProgress * 100; // Move from 0 to 100% up

  // Initiatives Section Progress (needed for phase 2 bars)
  const initStartY = departureEndY; // Starts right where departures end
  const initDuration = 6000;
  const initEndY = initStartY + initDuration;
  const initProgressRaw = Math.max(0, (scrollY - initStartY) / (initEndY - initStartY));
  const initProgress = Math.min(1, initProgressRaw);

  const barsExitStart = initStartY + 2500;
  const barsExitEnd = initStartY + 3300;

  const swarmStart = initStartY + 3500;
  const swarmEnd = swarmStart + 6500;

  const abstentionStart = swarmEnd - 2000;

  // Calculate final scroll height (dynamic)
  // Logic from AbstentionSection: Final content starts fading in at abstentionStart + 4000
  // It takes ~800px to fade in. We give it ~1500px buffer to settle.
  const finalContentStart = abstentionStart + 4000;
  const totalAppHeight = finalContentStart + 1500;

  // Phase 2: Approved bars transition (after user scrolls past phase 1)
  // When initProgress reaches a certain point (after bars are fully shown), swap to approved stats
  const approvedBarsStartProgress = 0.2; // Start transition when initProgress hits 0.2
  const approvedBarsEndProgress = 0.35; // Fade to approved bars at 0.35
  const approvedBarsOpacity = initProgress >= approvedBarsStartProgress
    ? Math.min(1, (initProgress - approvedBarsStartProgress) / (approvedBarsEndProgress - approvedBarsStartProgress))
    : 0;

  // subtitleMix Logic (Lifted for Title access)
  // Constants must match SwarmOverlay logic exactly
  const _clusterHold = 0.05;
  const _clusterRange = 0.6;
  const _authorHold = _clusterHold + _clusterRange + 0.15;
  const _authorRange = 0.6;
  const _projectHold = _authorHold + _authorRange + 0.15;
  const _projectRange = 0.6;

  const _rawProjectProgress = (initProgressRaw - (1 + _projectHold)) / _projectRange;
  const _projectProgress = Math.min(1, Math.max(0, _rawProjectProgress));
  const _projectEase = 1 - Math.pow(1 - _projectProgress, 3);
  const subtitleMix = _projectEase;

  // Final Phase: Chaotic Fall (Global for Title)
  // Final Phase: Chaotic Fall (Global for Title)
  const _chaosStart = _projectHold + _projectRange + 0.1;
  const _chaosRange = 0.3; // Slightly faster fall
  const _rawChaosProgress = (initProgressRaw - (1 + _chaosStart)) / _chaosRange;
  const _chaosProgress = Math.min(1, Math.max(0, _rawChaosProgress));
  const chaosEase = _chaosProgress * _chaosProgress;

  // Approved Laws Phase (After Chaos)
  const _approvedStart = _chaosStart + _chaosRange + 0.05; // Start SOONER after chaos
  const _approvedRange = 0.4; // Duration of fade in / count up
  const _rawApprovedProgress = (initProgressRaw - (1 + _approvedStart)) / _approvedRange;
  const _approvedProgress = Math.min(1, Math.max(0, _rawApprovedProgress));
  const approvedPhaseEase = 1 - Math.pow(1 - _approvedProgress, 3);




  if (view === 'database') {
    return <InitiativesTable onBack={() => handleViewChange('story')} />;
  }

  if (view === 'deputies') {
    return <DeputiesTable onBack={() => handleViewChange('story')} />;
  }

  return (
    <div className="app-container" style={{ opacity: isRestoring ? 0 : 1, transition: 'opacity 0.1s' }}>
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
          interventionsMap={interventionsMap}
        />

        {/* FILTER CONTROLS */}
        <div style={{
          position: 'fixed',
          top: isMobile ? '60px' : '80px',
          right: isMobile ? '16px' : '24px',
          opacity: (scrollProgress > 0.98 ? 1 : 0) * uiOpacity,
          pointerEvents: (scrollProgress > 0.98 && uiOpacity > 0.1) ? 'auto' : 'none',
          transition: 'opacity 0.2s',
          zIndex: 40,
          backgroundColor: 'rgba(255,255,255,0.9)',
          padding: isMobile ? '4px 8px' : '8px 16px',
          borderRadius: '20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          display: 'flex',
          gap: isMobile ? '4px' : '8px',
          alignItems: 'center',
          transform: isMobile ? 'scale(0.9)' : 'none',
          transformOrigin: 'top right'
        }}>


          <span style={{ fontSize: isMobile ? '9px' : '12px', fontWeight: 600, color: '#666', marginRight: isMobile ? '2px' : '4px' }}>AGRUPAR POR:</span>
          <button
            onClick={() => setGroupingCriteria('g_par')}
            style={{
              background: groupingCriteria === 'g_par' ? '#111' : '#eee',
              color: groupingCriteria === 'g_par' ? '#fff' : '#333',
              border: 'none', padding: isMobile ? '4px 8px' : '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: isMobile ? '10px' : '12px', fontWeight: 500
            }}>Grupo</button>
          <button
            onClick={() => setGroupingCriteria('partido')}
            style={{
              background: groupingCriteria === 'partido' ? '#111' : '#eee',
              color: groupingCriteria === 'partido' ? '#fff' : '#333',
              border: 'none', padding: isMobile ? '4px 8px' : '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: isMobile ? '10px' : '12px', fontWeight: 500
            }}>Partido</button>
          <button
            onClick={() => setGroupingCriteria('circunscripcion')}
            style={{
              background: groupingCriteria === 'circunscripcion' ? '#111' : '#eee',
              color: groupingCriteria === 'circunscripcion' ? '#fff' : '#333',
              border: 'none', padding: isMobile ? '4px 8px' : '6px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: isMobile ? '10px' : '12px', fontWeight: 500
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

            <div style={{
              width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', marginBottom: '12px', marginTop: '12px', border: '3px solid #f3f4f6', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <img
                src={`/images/diputados_img/${selectedDeputy.img || selectedDeputy.nombre.split(/[\s,]+/).join('_') + '.jpg'}`}
                alt={selectedDeputy.nombre}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  // If image fails, try constructed name as fallback, or hide
                  if (!e.target.src.includes(selectedDeputy.nombre.split(/[\s,]+/).join('_'))) {
                    e.target.src = `/images/diputados_img/${selectedDeputy.nombre.split(/[\s,]+/).join('_')}.jpg`;
                  } else {
                    e.target.style.display = 'none'; e.target.parentElement.style.display = 'none';
                  }
                }}
              />
            </div>

            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '28px', margin: '0 0 8px', color: '#111' }}>
              {selectedDeputy.formattedName}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <p style={{ margin: 0, color: '#4b5563', fontSize: '16px' }}>
                {selectedDeputy.trato} por <strong>{selectedDeputy.circunscripcion}</strong>
              </p>
              <p style={{ margin: 0, color: '#111827', fontWeight: 500, fontSize: '16px' }}>
                {selectedDeputy.fullPartyName}
              </p>
              <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Grupo Parlamentario {selectedDeputy.g_par}
              </p>

              {/* Voting Summary Block */}
              {votesByDeputy[String(selectedDeputy.id)] && (
                <div style={{ marginTop: '20px', width: '100%', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
                  <h4 style={{
                    fontSize: '12px',
                    margin: '0 0 12px',
                    color: '#6b7280',
                    fontFamily: 'var(--font-sans)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600
                  }}>
                    Resumen de votaciones
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: isMobile ? '4px' : '8px' }}>
                    {/* Helper for stats */}
                    {[
                      { l: 'Sí', c: votesByDeputy[String(selectedDeputy.id)].si, bg: '#dcfce7', txt: '#166534' },
                      { l: 'No', c: votesByDeputy[String(selectedDeputy.id)].no, bg: '#fee2e2', txt: '#991b1b' },
                      { l: 'Abs', c: votesByDeputy[String(selectedDeputy.id)].abs, bg: '#fef9c3', txt: '#854d0e' },
                      { l: 'NV', c: votesByDeputy[String(selectedDeputy.id)].nv, bg: '#f3f4f6', txt: '#374151' }
                    ].map((item) => (
                      <div key={item.l} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        backgroundColor: item.bg,
                        borderRadius: '8px',
                        padding: '8px 4px'
                      }}>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: item.txt, fontFamily: 'var(--font-serif)' }}>
                          {item.c}
                        </span>
                        <span style={{ fontSize: '11px', color: item.txt, fontWeight: 500, opacity: 0.8 }}>
                          {item.l}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interventions Summary */}
              {interventionsMap[selectedDeputy.nombre] !== undefined && interventionsMap[selectedDeputy.nombre] > 0 && (
                <div style={{ marginTop: '16px', width: '100%', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
                  <h4 style={{
                    fontSize: '12px',
                    margin: '0 0 12px',
                    color: '#6b7280',
                    fontFamily: 'var(--font-sans)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600
                  }}>
                    Tiempo de intervención
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'center' }}>
                    <span style={{ fontSize: '24px', fontWeight: 700, color: '#111', fontFamily: 'var(--font-serif)' }}>
                      {Math.floor(interventionsMap[selectedDeputy.nombre] / 60)}<span style={{ fontSize: '16px', fontWeight: 400 }}>h</span> {interventionsMap[selectedDeputy.nombre] % 60}<span style={{ fontSize: '16px', fontWeight: 400 }}>m</span>
                    </span>
                    <span style={{ fontSize: '14px', color: '#666' }}>
                      totales intervenidos
                    </span>
                  </div>
                </div>
              )}
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
              <h1 className="hero-title animate-enter">Dentro del Pleno</h1>
              <p className="hero-dek animate-enter delay-1">
                Crónica visual de un año en el hemiciclo
              </p>

              <p className="hero-credits animate-enter delay-3">
                Por <strong>J. Diego Tejera Sosa</strong>
              </p>
              <div
                className="scroll-hint animate-enter delay-4"
                style={{ opacity: scrollHintOpacity, marginTop: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}
              >
                <span className="scroll-text">Desliza hacia abajo para comenzar</span>
                <div className="scroll-icon">↓</div>
              </div>
            </header>
          </div>
        </div>
      </div>

      <div
        className={`search-section ${scrollY > 1600 && scrollY < 34000 && !selectedDeputy ? 'is-visible' : ''}`}
        style={{
          // Logic update: On mobile, if scroll is advanced (grouping), move search to top
          // OR just apply the requested layout changes permanently for mobile when visible
          opacity: (scrollY > 1600 && scrollY < 34000 && !selectedDeputy ? 1 : 0) * uiOpacity,
          pointerEvents: 'none', // Container passes clicks through
          zIndex: 99999, // Force highest priority
          position: 'fixed',
          transform: 'translate3d(0,0,0)', // Ensure hardware plane
          ...(isMobile && scrollProgress > 0.5 ? {
            top: '30px', // Above filters (which are at 60px)
            bottom: 'auto',
            transform: 'none',
            width: 'auto',
            right: '16px', // Align right like filters
            left: 'auto', // Override centering
            margin: 0
          } : {})
        }}
      >
        {!isMobile && (
          <h2 className="search-header" style={{ pointerEvents: scrollY > 1600 && scrollY < 34000 && !selectedDeputy ? 'auto' : 'none' }}>
            Conoce a los diputados
          </h2>
        )}

        <div style={{
          position: 'relative',
          width: '100%',
          maxWidth: isMobile ? '220px' : '400px', // Smaller on mobile
          margin: isMobile && scrollProgress > 0.5 ? '0' : '0 auto',
          transform: isMobile ? 'none' : undefined,
          pointerEvents: scrollY > 1600 && scrollY < 34000 && !selectedDeputy ? 'auto' : 'none'
        }}>
          <input
            type="text"
            className="search-input"
            placeholder={isMobile ? "Buscar..." : "Buscar diputado..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
            style={{
              width: '100%',
              fontSize: isMobile ? '10px' : undefined,
              padding: isMobile ? '4px 12px' : undefined,
              background: 'rgba(255,255,255,0.95)',
              boxShadow: isMobile ? '0 2px 8px rgba(0,0,0,0.1)' : undefined,
              borderRadius: isMobile ? '20px' : undefined, // Pill shape
              height: isMobile ? '20px' : undefined, // Even more compact height
              border: isMobile ? '1px solid #ddd' : undefined
            }}
          />
          {isSearchFocused && searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '8px',
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              padding: '8px 0',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10000,
              maxHeight: '400px',
              overflowY: 'auto',
              textAlign: 'left'
            }}>
              {searchResults.slice(0, isMobile ? 5 : 3).map(d => (
                <div
                  key={d.id}
                  onClick={() => {
                    const dep = getDeputyData(d.asiento ? parseInt(d.asiento) : getVirtualSeatId(d.id));
                    setSelectedDeputy(dep);
                    setSearchTerm("");
                  }}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.target.style.background = '#f3f4f6'}
                  onMouseLeave={(e) => e.target.style.background = 'transparent'}
                >
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#eee' }}>
                    <img
                      src={`/images/diputados_img/${d.img || d.nombre.split(/[\s,]+/).join('_') + '.jpg'}`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#111' }}>{formatName(d.nombre)}</span>
                    <span style={{ fontSize: '12px', color: '#666' }}>{d.partido} · {d.circunscripcion}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ height: `${totalAppHeight}px` }} className="scroll-section">
        <div
          className="nyt-info-box"
          style={{
            opacity: (scrollY > 350 && scrollY < 800 ? 1 : 0) * uiOpacity,
            transform: scrollY > 350 ? (isMobile ? 'translateY(-20px)' : 'translateY(0)') : 'translateY(20px)',
            pointerEvents: scrollY > 350 && scrollY < 800 ? 'auto' : 'none'
          }}
        >
          350 diputados y 18 ministros sin acta ocupan sus escaños
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
            No todos los escaños llegan a diciembre con la misma persona
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
            opacity: departureProgress > 0.88 ? (1 - (departureProgress - 0.88) * 80) : 1,
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
            color: '#000000',
            // Appear a bit after line starts (0.01)
            // Fade out smoothly starting at 0.15, gone by 0.18
            opacity: Math.max(0, Math.min(1, (departureProgress - 0.01) * 10)) * Math.max(0, 1 - (departureProgress - 0.01) * 2),
            // Removed transition on 'bottom' to prevent jitter with scroll updates
            transition: 'opacity 0.2s',
            zIndex: 48
          }}>
            Estos fueron los 10 diputados que causaron baja (y uno suspendido) durante 2025
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
                      if (d.nombre.includes('Ábalos')) return isMobile ? '-60px' : '-200px';
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
                      src={d.imagen.includes('.') ? `images/${d.imagen}` : `images/${d.imagen}.png`}
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
                    {d.fecha_baja
                      ? `Baja el ${parseJsonDate(d.fecha_baja).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : 'Suspensión de derechos como diputado'}
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
              // Animate counters from 0.85 to 0.92 (reach 100%)
              // Stay visible from 0.92 to 0.88 (pause) - shortened
              // Fade out from 0.88 to 0.90 (completely gone before bars start)
              const startStats = 0.90;
              const endCounters = 0.94; // Counters reach 100% here
              const startFadeOut = 0.96; // Start fading earlier
              const completeFadeOut = 0.975; // Completely gone before bars start at 0.90

              let statsOpacity = 1;

              // Fade in
              if (departureProgress < startStats) {
                statsOpacity = 0;
              } else if (departureProgress < endCounters) {
                statsOpacity = Math.min(1, (departureProgress - startStats) * 50); // Fade in faster (fully visible by 0.92)
              } else if (departureProgress < startFadeOut) {
                statsOpacity = 1; // Stay visible (pause)
              } else if (departureProgress < completeFadeOut) {
                statsOpacity = Math.max(0, 1 - (departureProgress - startFadeOut) / (completeFadeOut - startFadeOut)); // Fade out
              } else {
                statsOpacity = 0;
              }

              // Counter Progress (0 to 1) - reaches 100% at 0.92
              const countP = Math.min(1, Math.max(0, (departureProgress - startStats) / (endCounters - startStats)));

              // Counters
              const countSesiones = Math.floor(countP * 66);
              const countVotaciones = Math.floor(countP * 50);

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
                    En 2025 hubo <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'inline-block', minWidth: '2ch', textAlign: 'center' }}>{countSesiones}</span> sesiones plenarias.
                  </div>
                  <div style={{ fontSize: isMobile ? '28px' : '48px', lineHeight: 1.2, color: '#000' }}>
                    En <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'inline-block', minWidth: '2ch', textAlign: 'center' }}>{countVotaciones}</span> se votó.
                  </div>
                </div>
              );
            })()
          }

          {/* Animated Bars for Initiative Types */}
          {(() => {
            // Always show bars, but they transition between phases
            // Phase 1: Proposiciones, Proyectos, Reforma (barsOpacity controls visibility)
            // Phase 2: Leyes, Reales decretos, Leyes orgánicas (approvedBarsOpacity controls transition)

            // Determine which data set to show based on phase progress
            const phase1Opacity = barsOpacity * (1 - approvedBarsOpacity);
            const phase2Opacity = approvedBarsOpacity;

            // Fade out bars section before swarm appears
            // Swarm starts earlier now. Let's start fading bars out at 30500 to be gone by 31300
            // const barsExitStart = 30500; // Now defined in main scope
            // const barsExitEnd = 31300;
            const barsExitProgress = Math.min(1, Math.max(0, (scrollY - barsExitStart) / (barsExitEnd - barsExitStart)));
            const barsExitOpacity = 1 - barsExitProgress;

            if (barsOpacity === 0 && approvedBarsOpacity === 0) return null;

            return (
              <div style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '90%',
                maxWidth: '900px',
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '30px',
                zIndex: 51,
                opacity: barsOpacity * barsExitOpacity, // Multiply by exit opacity
                transition: 'none',
                pointerEvents: (barsOpacity * barsExitOpacity > 0.1) ? 'auto' : 'none'
              }}>
                {/* Title - changes based on phase */}
                <div style={{
                  textAlign: 'center',
                  opacity: 1
                }}>
                  <h3 style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: isMobile ? '20px' : '28px',
                    fontWeight: 700,
                    margin: 0,
                    color: '#111',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.3em'
                  }}>
                    <span>Se</span>
                    <span style={{
                      display: 'inline-grid',
                      gridTemplateAreas: '"stack"',
                      alignItems: 'center',
                      justifyItems: 'center'
                    }}>
                      <span style={{
                        gridArea: 'stack',
                        opacity: 1 - approvedBarsOpacity,
                        transition: 'none', // Driven directly by scroll
                      }}>presentaron</span>
                      <span style={{
                        gridArea: 'stack',
                        opacity: approvedBarsOpacity,
                        transition: 'none', // Driven directly by scroll
                      }}>aprobaron</span>
                    </span>
                    <span>un total de</span>
                  </h3>

                  {/* Subtitle with total count - always rendered to reserve space, fades in */}
                  <div style={{
                    marginTop: '16px',
                    fontSize: isMobile ? '28px' : '42px',
                    fontWeight: 700,
                    color: '#111',
                    fontVariantNumeric: 'tabular-nums',
                    opacity: phase2Opacity, // Fades in during Phase 2
                    transition: 'opacity 0.2s'
                  }}>
                    {Math.floor(approvedStats.reduce((sum, item) => sum + item.count, 0))}
                    <span style={{
                      fontSize: isMobile ? '14px' : '18px',
                      fontWeight: 500,
                      color: '#666',
                      marginLeft: '12px'
                    }}>
                      iniciativas legislativas
                    </span>
                  </div>
                </div>

                {/* Bars - Morphing Strategy */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  gap: isMobile ? '4px' : '50px',
                  height: '280px',
                  width: '100%',
                  position: 'relative'
                }}>
                  {[0, 1, 2].map((index) => {
                    const progress = approvedBarsOpacity; // 0 to 1 transition

                    // Data
                    const item1 = initiativesCounts[index];
                    const item2 = approvedStats[index];

                    if (!item1 || !item2) return null;

                    // Interpolate Value
                    // Start at item1.count, end at item2.count
                    const startVal = item1.count;
                    const endVal = item2.count;
                    const currentVal = startVal + (endVal - startVal) * progress;

                    // Display rounded value
                    // Multiply by barsProgress to handle the initial "growth" animation from 0
                    const displayVal = Math.floor(currentVal * barsProgress);

                    // Interpolate Height
                    // We keep the scale of Phase 1 (Max Value) to show the drop visually
                    // If we re-scaled to Phase 2 max, the small numbers would look huge
                    const maxScale = Math.max(...initiativesCounts.map(d => d.count));
                    const targetHeight = (currentVal / maxScale) * 260; // 260px is max bar height
                    const currentHeight = targetHeight * barsProgress;

                    return (
                      <div key={index} style={{
                        position: 'relative',
                        height: '100%',
                        width: isMobile ? '100px' : '140px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        alignItems: 'center'
                      }}>
                        {/* Counter */}
                        <div style={{
                          fontFamily: 'var(--font-serif)',
                          fontSize: isMobile ? '24px' : '42px',
                          fontWeight: 700,
                          marginBottom: '8px',
                          color: item1.color,
                          fontVariantNumeric: 'tabular-nums',
                          minHeight: isMobile ? '28px' : '48px',
                          textAlign: 'center'
                        }}>
                          {displayVal}
                        </div>

                        {/* Bar */}
                        <div style={{
                          width: isMobile ? '50px' : '80px',
                          height: `${Math.max(2, currentHeight)}px`, // Min 2px to be visible
                          backgroundColor: item1.color,
                          borderRadius: '4px 4px 0 0',
                          boxShadow: `0 2px 12px ${item1.color}50`,
                          transition: 'none' // Remove transition to sync perfectly with scroll
                        }} />

                        {/* Labels Stack */}
                        <div style={{
                          marginTop: '12px',
                          textAlign: 'center',
                          fontFamily: 'var(--font-sans)',
                          fontSize: isMobile ? '10px' : '14px',
                          fontWeight: 500,
                          color: '#555',
                          lineHeight: 1.1,
                          display: 'grid',
                          gridTemplateAreas: '"label"',
                          alignItems: 'start',
                          justifyItems: 'center',
                          width: '100%'
                        }}>
                          <span style={{
                            gridArea: 'label',
                            opacity: 1 - progress,
                            transition: 'none'
                          }}>
                            {item1.label}
                          </span>
                          <span style={{
                            gridArea: 'label',
                            opacity: progress,
                            transition: 'none'
                          }}>
                            {item2.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {/* LEGISLATIVE SWARM (CIRCLES) */}
      <LegislativeSwarm
        scrollY={scrollY}
        sectionStart={swarmStart}
        nodes={swarmData.nodes}
        categories={swarmData.categories}
        width={size.width}
        height={size.height}
        isMobile={isMobile}
        onOpenDatabase={() => handleViewChange('database')}
      />

      {/* ABSTENTION SECTION */}
      <AbstentionSection
        scrollY={scrollY}
        sectionStart={abstentionStart}
        leaders={abstentionLeaders}
        isMobile={isMobile}
        onNavigate={(v) => handleViewChange(v)}
      />
    </div>
  );
}

// ==========================================
// SUB-COMPONENT: LegislativeSwarm
// ==========================================
function LegislativeSwarm({ scrollY, sectionStart, nodes, categories, width, height, isMobile, onOpenDatabase }) {
  // 1. CONFIGURATION
  const SECTION_START = sectionStart || 31500;
  const SECTION_TRANSITION = 4000;
  const SECTION_END = SECTION_START + 6500; // REDUCED from 45000 to shorten scroll

  const [selectedNode, setSelectedNode] = useState(null);

  const rawP = (scrollY - SECTION_START) / SECTION_TRANSITION;
  const progress = Math.min(1, Math.max(0, rawP));

  // Only render if we are near the section
  if (scrollY < SECTION_START - 2000 || scrollY > SECTION_END + 2000) return null;



  // JSX RETURN
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0,
      width: '100%', height: '100%',
      pointerEvents: 'none',
      zIndex: 60,
      opacity: Math.min(1, (scrollY - SECTION_START + 500) / 500, Math.max(0, (SECTION_END - 1000 - scrollY) / 1000)) // Fade in, then fade out before END
    }}>
      {/* 0. TITLE */}
      <div style={{
        position: 'absolute',
        top: '8%',
        width: '100%',
        textAlign: 'center',
        opacity: Math.max(0, (progress - 0.2) * 2),
        transition: 'opacity 0.3s ease'
      }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '24px' : '32px', fontWeight: 700, color: '#111', margin: 0 }}>
          Cómo terminaron (o siguen) las iniciativas legislativas de 2025
        </h2>
      </div>

      {/* 1. Cluster Labels */}
      <div style={{
        position: 'absolute',
        top: isMobile ? '25%' : '15%',
        width: '100%',
        display: 'flex',
        justifyContent: 'space-around',
        opacity: Math.max(0, (progress - 0.5) * 2),
        transition: 'opacity 0.3s ease'
      }}>
        {categories.map(cat => {
          const count = nodes.filter(n => n.status === cat).length;
          return (
            <div key={cat} style={{ textAlign: 'center', width: `${100 / categories.length}%` }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: isMobile ? '12px' : '16px', color: '#111', marginBottom: '4px' }}>{cat}</div>
              <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: isMobile ? '16px' : '24px', color: '#555' }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* 2. SVG */}
      <svg width={width} height={height} style={{ pointerEvents: 'none' }}>
        {nodes.map((node) => {
          const x = node.cloudX + (node.clusterX - node.cloudX) * progress;
          const y = node.cloudY + (node.clusterY - node.cloudY) * progress;
          const isSelected = selectedNode && selectedNode.id === node.id;

          // Reduce radius on mobile
          const baseR = isMobile ? node.r * 0.6 : node.r;

          return (
            <circle
              key={node.id}
              cx={x} cy={y}
              r={isSelected ? (baseR * 2.5) : baseR}
              fill={node.color}
              stroke="white"
              strokeWidth={isSelected ? 2 : 0.5}
              style={{ pointerEvents: 'auto', cursor: 'pointer', transition: 'r 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), stroke-width 0.2s', opacity: 0.9 }}
              onClick={() => setSelectedNode(isSelected ? null : node)}
            />
          );
        })}
      </svg>

      {/* 4. Detail Card */}
      {selectedNode && (
        <div className="deputy-card" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: 'white', padding: '32px 24px 48px',
          borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
          boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.15)', zIndex: 100,
          maxWidth: '1000px', margin: '0 auto', textAlign: 'center',
          borderTop: '1px solid #e5e7eb', animation: 'slide-up 0.3s ease-out',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', pointerEvents: 'auto'
        }}>
          <button onClick={() => setSelectedNode(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '18px', cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>✕</button>

          <div style={{ backgroundColor: selectedNode.color, color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
            {selectedNode.status}
          </div>

          <h3 style={{ margin: '0', fontFamily: 'var(--font-serif)', fontSize: isMobile ? '18px' : '22px', lineHeight: 1.3, color: '#111', maxWidth: '90%' }}>
            {selectedNode.titulo}
          </h3>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', color: '#666', fontSize: '13px', marginTop: '4px' }}>
            {selectedNode.data.fecha_presentacion && <span>• <strong>Presentada:</strong> {new Date(selectedNode.data.fecha_presentacion).toLocaleDateString()}</span>}
            {selectedNode.data.autor && <span>• <strong>Autor:</strong> {selectedNode.data.autor}</span>}
          </div>

          {(selectedNode.voteData || selectedNode.resultOverride || selectedNode.customNote) && (
            <div style={{ marginTop: '24px', width: '100%', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
              <h4 style={{ fontSize: '12px', margin: '0 0 12px', color: '#6b7280', fontFamily: 'var(--font-sans)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Resultado de la votación</h4>

              {selectedNode.resultOverride ? (
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '16px' : '18px', color: '#111', lineHeight: 1.4, maxWidth: '80%', margin: '0 auto', padding: '12px', backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  {selectedNode.resultOverride}
                </div>
              ) : selectedNode.voteData ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: isMobile ? '4px' : '8px' }}>
                  {[
                    { l: 'A favor', c: selectedNode.voteData.si, bg: '#dcfce7', txt: '#166534' },
                    { l: 'En contra', c: selectedNode.voteData.no, bg: '#fee2e2', txt: '#991b1b' },
                    { l: 'Abstención', c: selectedNode.voteData.abs, bg: '#fef9c3', txt: '#854d0e' },
                    { l: 'No votan', c: selectedNode.voteData.nv, bg: '#f3f4f6', txt: '#374151' }
                  ].map(item => (
                    <div key={item.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: item.bg, borderRadius: '8px', padding: '8px 4px' }}>
                      <span style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 700, color: item.txt, fontFamily: 'var(--font-serif)' }}>{item.c}</span>
                      <span style={{ fontSize: isMobile ? '10px' : '11px', color: item.txt, fontWeight: 500, opacity: 0.8, textAlign: 'center', lineHeight: 1.2 }}>{item.l}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedNode.customNote && (
                <div style={{ marginTop: '16px', fontFamily: 'var(--font-sans)', fontSize: isMobile ? '12px' : '14px', color: '#555', backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px', maxWidth: '90%', margin: '16px auto 0', border: '1px solid #e5e7eb' }}>
                  {selectedNode.customNote}
                </div>
              )}
            </div>
          )}


        </div>
      )}

      {/* Button Link */}
      <div style={{
        position: 'absolute', bottom: '100px', width: '100%', textAlign: 'center',
        opacity: selectedNode ? 0 : Math.max(0, Math.min((progress - 0.8) * 5, 1 - (scrollY - 35500) / 500)),
        pointerEvents: (progress > 0.8 && !selectedNode && scrollY < 35500) ? 'auto' : 'none',
        zIndex: 200
      }}>
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: isMobile ? '12px' : '16px',
          maxWidth: isMobile ? '70%' : '100%',
          margin: '0 auto 16px',
          lineHeight: '1.4',
          color: '#333',
          fontWeight: 500,
          textShadow: '0 1px 2px rgba(255,255,255,0.8)',
          pointerEvents: 'none'
        }}>
          Esto es solo una parte del año legislativo. Si quieres ver el pleno completo:
        </p>
        <button
          onClick={onOpenDatabase}
          type="button"
          style={{ background: '#111', color: '#fff', border: 'none', padding: isMobile ? '8px 16px' : '12px 24px', borderRadius: '30px', fontSize: isMobile ? '13px' : '16px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', pointerEvents: 'auto' }}>
          Accede a todas las votaciones en el Pleno
        </button>
      </div>
    </div>
  );
}


// ==========================================
// SUB-COMPONENT: AbstentionSection
// ==========================================

function AbstentionSection({ scrollY, sectionStart, leaders, isMobile, onNavigate }) {
  const START = sectionStart || 36000; // Reduced from 40000
  const FADE_OUT_START = START + 3000; // Reduced from 43000
  const FINAL_START = START + 4000; // Reduced from 44000
  const STAGGER_STEP = 600;

  const [showCredits, setShowCredits] = useState(false);

  // 3. Final Section Opacity
  const finalOpacity = Math.min(1, Math.max(0, (scrollY - FINAL_START) / 800));

  // Trigger credits
  useEffect(() => {
    if (finalOpacity > 0.5) {
      const timer = setTimeout(() => setShowCredits(true), 500);
      return () => clearTimeout(timer);
    } else {
      setShowCredits(false);
    }
  }, [finalOpacity]);

  if (scrollY < START - 1000) return null;

  // 1. Base Opacity (Entrance)
  const opEntry = Math.min(1, Math.max(0, (scrollY - START) / 500));

  // 2. Abstention Exit
  const opExit = 1 - Math.min(1, Math.max(0, (scrollY - FADE_OUT_START) / 1000));

  // Combined Opacity for Abstention Block
  const abstentionGlobalOpacity = opEntry * opExit;

  // Staggering for Abstention items
  const opJunts = Math.min(1, Math.max(0, (scrollY - START) / 600));
  const opSanchezVotes = Math.min(1, Math.max(0, (scrollY - (START + STAGGER_STEP)) / 600));
  const opSanchezTalks = Math.min(1, Math.max(0, (scrollY - (START + STAGGER_STEP * 2)) / 600));

  if (!leaders || leaders.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0,
      width: '100%', height: '100%',
      // Use flex to center, but allow overflow for scrolling
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'center', // Top aligned on mobile for scroll
      pointerEvents: abstentionGlobalOpacity > 0.1 || finalOpacity > 0.1 || opSanchezTalks > 0.1 ? 'auto' : 'none', // Allow interaction when any content is visible
      zIndex: 70,
      // Background: White, masking underlying content
      backgroundColor: `rgba(255,255,255,${0.95 * Math.max(abstentionGlobalOpacity, finalOpacity)})`,
      overflowY: 'auto', // Enable scrolling
      WebkitOverflowScrolling: 'touch'
    }}>
      {/* ABSTENTION CONTENT */}
      <div style={{
        display: abstentionGlobalOpacity > 0 ? 'flex' : 'none',
        opacity: abstentionGlobalOpacity,
        justifyContent: 'center',
        gap: isMobile ? '12px' : '64px', // Reduced gap
        maxWidth: '1200px', width: '100%',
        padding: isMobile ? '20px 16px 40px' : '0 40px', // Add padding for scroll spacing
        flexWrap: 'wrap', alignItems: 'flex-start'
      }}>
        {/* Column 1: Junts */}
        <div style={{
          flex: '1 1 300px', // Allow shrinking
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: opJunts,
          transition: 'opacity 0.3s ease-out'
        }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '16px' : '36px', fontWeight: 700, color: '#111', marginBottom: isMobile ? '-24px' : '24px', position: 'relative', zIndex: 10 }}>
            Junts se abstiene
          </h2>

          <div style={{ marginBottom: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src="/images/abstencion.png"
              alt="Abstención"
              style={{ maxWidth: '100%', maxHeight: isMobile ? '120px' : '550px', width: 'auto', height: 'auto' }}
            />
          </div>

          <p style={{ fontFamily: 'var(--font-sans)', fontSize: isMobile ? '11px' : '18px', color: '#333', lineHeight: '1.4', marginTop: isMobile ? '-20px' : '-20px' }}>
            Con <strong>122 abstenciones</strong> cada uno, <strong>Josep Maria Cervera Pinart, Marta Marenas i Mir</strong> y <strong>Josep Pagès i Massó</strong> fueron los diputados que más veces se abstuvieron en 2025. <strong>Los tres pertenecen al Grupo Parlamentario Junts per Catalunya</strong>.
          </p>
        </div>

        {/* Column 2: Pedro Sánchez */}
        <div style={{
          flex: '1 1 300px',
          opacity: opSanchezVotes,
          transition: 'opacity 0.3s ease-out'
        }}>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '4px' : '32px', alignItems: 'center', textAlign: isMobile ? 'center' : 'left', marginTop: isMobile ? '-24px' : '0' }}>
            {/* Image on the left */}
            <div style={{ flex: '0 0 auto' }}>
              <img
                src="/images/pedro_sanchez.png"
                alt="Pedro Sánchez"
                style={{ maxWidth: isMobile ? '80px' : '250px', height: 'auto', display: 'block' }}
              />
            </div>

            {/* Texts on the right */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '32px', marginTop: isMobile ? '-5px' : '64px' }}>

              {/* Block 1: Votes */}
              <div>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '16px' : '32px', fontWeight: 700, color: '#111', marginBottom: isMobile ? '2px' : '16px', marginTop: 0 }}>
                  El escaño más ocupado
                </h2>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: isMobile ? '11px' : '18px', color: '#333', lineHeight: '1.4', margin: 0 }}>
                  <strong>Pedro Sánchez Pérez-Castejón</strong>, presidente del Gobierno, <strong>no votó en 429</strong> de las <strong>más de 700 votaciones</strong> celebradas en 2025 en el Pleno del Congreso de los Diputados.
                </p>
              </div>

              {/* Block 2: Interventions */}
              <div style={{ opacity: opSanchezTalks, transition: 'opacity 0.3s ease-out' }}>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '16px' : '32px', fontWeight: 700, color: '#111', marginBottom: isMobile ? '2px' : '16px', marginTop: 0 }}>
                  Pero el que más habló
                </h2>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: isMobile ? '11px' : '18px', color: '#333', lineHeight: '1.4', margin: 0 }}>
                  Aún así, su presencia se dejó oír: <strong>intervino 123 veces</strong> en los plenos, con un total de <strong>40 horas y 49 minutos</strong> de palabra.
                </p>
                <div style={{ marginTop: '8px', fontSize: isMobile ? '10px' : '12px', color: '#999', fontStyle: 'italic' }}>
                  Datos actualizados a 30 de noviembre de 2025.
                </div>
              </div>

            </div>
          </div>

          {/* Desktop Button - Inside Column */}
          <div style={{ marginTop: '48px', textAlign: 'center', opacity: opSanchezTalks, transition: 'opacity 0.3s ease-out', display: isMobile ? 'none' : 'block' }}>
            <button onClick={() => {
              onNavigate('deputies');
            }} style={{
              background: '#111',
              color: '#fff',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '30px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              pointerEvents: 'auto'
            }}>
              Accede a los datos de los diputados
            </button>
          </div>

        </div>

        {/* Mobile Button - Full Width Bottom */}
        <div style={{ width: '100%', marginTop: '12px', textAlign: 'center', opacity: opSanchezTalks, transition: 'opacity 0.3s ease-out', display: isMobile ? 'block' : 'none' }}>
          <button onClick={() => {
            onNavigate('deputies');
          }} style={{
            background: '#111',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '30px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            pointerEvents: 'auto'
          }}>
            Accede a los datos de los diputados
          </button>
        </div>

      </div>

      {/* FINAL SECTION */}
      <div style={{
        display: finalOpacity > 0.01 ? 'flex' : 'none',
        opacity: finalOpacity,
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '48px',
        pointerEvents: finalOpacity > 0.5 ? 'auto' : 'none'
      }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: isMobile ? '36px' : '56px', fontWeight: 700, color: '#111', marginBottom: '16px', textAlign: 'center' }}>
          Dentro del Pleno
        </h1>

        <div style={{ display: 'flex', gap: isMobile ? '16px' : '24px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => {
            if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
            window.location.reload();
          }}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              borderRadius: '30px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: isMobile ? '12px' : '16px',
              color: '#333',
              padding: isMobile ? '6px 14px' : '10px 20px',
              fontWeight: 500,
              transition: 'all 0.2s',
              zIndex: 100
            }}
            onMouseEnter={(e) => { e.target.style.background = '#111'; e.target.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#333'; }}
          >
            Volver al inicio
          </button>

          <button
            onClick={() => onNavigate('deputies')}
            style={{
              background: '#111',
              border: 'none',
              borderRadius: '30px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: isMobile ? '12px' : '16px',
              color: '#fff',
              padding: isMobile ? '6px 14px' : '10px 20px',
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              transition: 'transform 0.2s',
              zIndex: 100
            }}
            onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
          >
            Diputados
          </button>

          <button
            onClick={() => onNavigate('database')}
            style={{
              background: '#111',
              border: 'none',
              borderRadius: '30px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: isMobile ? '12px' : '16px',
              color: '#fff',
              padding: isMobile ? '6px 14px' : '10px 20px',
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              transition: 'transform 0.2s',
              zIndex: 100
            }}
            onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
          >
            Votaciones
          </button>
        </div>

        <div style={{
          marginTop: isMobile ? '120px' : '64px',
          marginBottom: '32px',
          opacity: showCredits ? 1 : 0,
          transition: 'opacity 1s ease-in-out',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: isMobile ? '14px' : '16px', fontWeight: 600, color: '#333' }}>
            J. Diego Tejera Sosa
          </span>

          <div style={{ display: 'flex', gap: '24px', marginTop: '0px' }}>
            <a href="https://www.linkedin.com/in/juandiegotejerasosa/" target="_blank" rel="noopener noreferrer"
              className="shiny-icon"
              style={{ color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
              </svg>
            </a>
            <a href="mailto:jdiegotejeras@gmail.com"
              className="shiny-icon"
              style={{ color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </a>
            <a href="https://diegotejera.pages.dev" target="_blank" rel="noopener noreferrer"
              className="shiny-icon"
              style={{ color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </a>
          </div>

          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: '#999', margin: '24px 0 0', textAlign: 'center', maxWidth: '300px', lineHeight: 1.5 }}>
            Datos obtenidos del <a href="https://www.congreso.es/es/datos-abiertos" target="_blank" rel="noopener noreferrer" style={{ color: '#999', textDecoration: 'underline' }}>Portal de Datos Abiertos</a> de la web del <a href="https://www.congreso.es/es/home" target="_blank" rel="noopener noreferrer" style={{ color: '#999', textDecoration: 'underline' }}>Congreso de los Diputados</a>.
          </p>
        </div>
      </div>
    </div >
  );
}
