import React, { useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import diputadosData from '../../public/data/diputados.json';
import partidosData from '../../public/data/partidos.json';

export default function InitiativesTable({ onBack }) {
    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc', isDefault: true });
    const [filterResult, setFilterResult] = useState('all'); // all, approved, rejected

    // Modal State
    const [selectedInitiative, setSelectedInitiative] = useState(null);
    const [votesMap, setVotesMap] = useState(null);
    const [votesLoading, setVotesLoading] = useState(false);
    const [modalSearch, setModalSearch] = useState('');

    // Crear mapa de siglas de partido -> nombre completo
    const partidoMap = useMemo(() => {
        const map = {};
        partidosData.forEach(p => {
            map[p.siglas] = p.nombre;
        });
        return map;
    }, []);

    const handleRowClick = (row) => {
        setSelectedInitiative(row);
        // Load votes if not loaded
        if (!votesMap && !votesLoading) {
            setVotesLoading(true);

            // 1. Fetch Summary to get chunks
            fetch("/data/out_votaciones/summary.json")
                .then(res => res.json())
                .then(summary => {
                    const chunkFiles = summary.votos_chunks || [];
                    const promises = chunkFiles.map(f => d3.csv(`/data/out_votaciones/${f}`));

                    Promise.all(promises).then(results => {
                        const map = {};
                        // Process all chunks
                        results.forEach(chunkData => {
                            chunkData.forEach(v => {
                                // Use integer ID
                                const uid = v.votacion_id;
                                if (!map[uid]) map[uid] = [];
                                map[uid].push(v);
                            });
                        });
                        setVotesMap(map);
                        setVotesLoading(false);
                    });
                })
                .catch(err => {
                    console.error("Error loading votes summary:", err);
                    setVotesLoading(false);
                });
        }
    };

    // Bloquear scroll cuando el modal está abierto
    useEffect(() => {
        if (selectedInitiative) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        // Cleanup al desmontar
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [selectedInitiative]);

    // Helper to get votes for the modal
    const getCurrentVotes = () => {
        if (!selectedInitiative || !votesMap) return { si: [], no: [], abs: [], noVota: [] };

        // Use 'id' (which corresponds to votacion_id)
        const votes = votesMap[selectedInitiative.id] || [];

        const normalize = (v) => (v || "").toLowerCase().trim();
        const searchTerm = modalSearch.toLowerCase().trim();

        const si = [];
        const no = [];
        const abs = [];
        const noVota = [];

        votes.forEach(v => {
            const val = normalize(v.voto);

            // Primero intentar buscar por ID
            let dep = diputadosData.find(d => String(d.id) === String(v.diputado_id));

            // Si no encuentra por ID (o el ID está vacío), intentar buscar por nombre
            if (!dep && v.diputado_xml) {
                // Normalizar el nombre del CSV eliminando espacios extras
                const nombreCSV = v.diputado_xml.trim();
                dep = diputadosData.find(d => {
                    // Comparar nombres ignorando diferencias en "del Socorro" vs sin ello
                    const nombreJSON = d.nombre.trim();
                    // Si coincide exactamente
                    if (nombreJSON === nombreCSV) return true;
                    // Si el nombre del JSON contiene el del CSV (caso "María del Socorro" vs "María")
                    if (nombreJSON.startsWith(nombreCSV)) return true;
                    // Si el nombre del CSV es una versión corta del JSON
                    const baseCSV = nombreCSV.split(',')[0]; // Solo apellido
                    const baseJSON = nombreJSON.split(',')[0];
                    return baseCSV === baseJSON;
                });
            }

            const info = {
                name: dep ? formatName(dep.nombre) : `Desconocido (${v.diputado_xml})`,
                party: dep ? dep.partido : (v.grupo || '?'),
                partyFull: dep ? (partidoMap[dep.partido] || '') : '',  // Nombre completo del partido
                img: dep ? dep.img : null
            };

            // Filtrar por búsqueda si hay término
            if (searchTerm) {
                const matchesName = info.name.toLowerCase().includes(searchTerm);
                const matchesPartyShort = info.party.toLowerCase().includes(searchTerm);
                const matchesPartyFull = info.partyFull.toLowerCase().includes(searchTerm);
                if (!matchesName && !matchesPartyShort && !matchesPartyFull) return; // Skip este voto
            }

            if (val === 'sí' || val === 'si') si.push(info);
            else if (val === 'no') no.push(info);
            else if (val === 'abstención' || val === 'abstencion') abs.push(info);
            else noVota.push(info); // No vota, ausente, etc.
        });

        // Sort by party
        const sortByParty = (a, b) => a.party.localeCompare(b.party);
        return {
            si: si.sort(sortByParty),
            no: no.sort(sortByParty),
            abs: abs.sort(sortByParty),
            noVota: noVota.sort(sortByParty)
        };
    };

    useEffect(() => {
        d3.csv("/data/out_votaciones/votaciones.csv").then(csvData => {
            // Process data
            const processed = csvData.map(d => {
                const a_favor = +d.a_favor || 0;
                const en_contra = +d.en_contra || 0;
                const abstenciones = +d.abstenciones || 0;
                const total = a_favor + en_contra + abstenciones;

                return {
                    ...d,
                    fecha: new Date(d.fecha),
                    a_favor,
                    en_contra,
                    abstenciones,
                    total,
                    result: a_favor > en_contra ? 'Aprobada' : 'Rechazada', // Simple logic, can be refined
                    // Use new Integer ID as the primary ID
                    id: d.id
                };
            });
            setData(processed);
            setLoading(false);
        });
    }, []);

    // Filtering
    const filteredData = useMemo(() => {
        return data.filter(item => {
            const matchSearch = (
                (item.texto_expediente || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (item.titulo_punto || '').toLowerCase().includes(searchTerm.toLowerCase())
            );

            const matchResult = filterResult === 'all'
                ? true
                : filterResult === 'approved' ? item.result === 'Aprobada' : item.result === 'Rechazada';

            return matchSearch && matchResult;
        });
    }, [data, searchTerm, filterResult]);

    // Sorting
    const sortedData = useMemo(() => {
        let sortable = [...filteredData];
        if (sortConfig !== null) {
            sortable.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortable;
    }, [filteredData, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const [visibleCount, setVisibleCount] = useState(10);

    // Reset pagination when filters sort change
    useEffect(() => {
        setVisibleCount(10);
    }, [searchTerm, filterResult, sortConfig]);

    const handleShowMore = () => {
        setVisibleCount(prev => prev + 10);
    };

    if (loading) return <div style={{ padding: 40, fontFamily: 'var(--font-sans)', textAlign: 'center' }}>Cargando datos...</div>;

    const currentData = sortedData.slice(0, visibleCount);
    const hasMore = visibleCount < sortedData.length;

    return (
        <div style={{
            minHeight: '100vh',
            background: '#f8f8f8',
            color: '#111',
            fontFamily: 'var(--font-sans)',
            padding: '40px 20px'
        }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
                    <div>
                        <button
                            onClick={onBack}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '14px',
                                textDecoration: 'underline',
                                color: '#666',
                                marginBottom: 10
                            }}
                        >
                            ← Volver al hemiciclo
                        </button>
                        <h1 style={{ fontSize: '32px', fontWeight: 700, margin: 0, fontFamily: 'var(--font-serif)' }}>
                            Iniciativas y leyes en el Congreso en 2025
                        </h1>
                        <p style={{ color: '#666', marginTop: 10 }}>
                            Explora todas las votaciones registradas en 2025 en el Congreso de los Diputados.
                        </p>
                    </div>
                </div>

                {/* Controls */}
                <div style={{
                    display: 'flex',
                    gap: 20,
                    marginBottom: 30,
                    background: 'white',
                    padding: 20,
                    borderRadius: 8,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ flex: 1, minWidth: 250 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: 5, color: '#999' }}>BUSCAR</label>
                        <input
                            type="text"
                            placeholder="Buscar por título o descripción..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px',
                                border: '1px solid #ddd',
                                borderRadius: 4,
                                fontSize: '14px'
                            }}
                        />
                    </div>
                    <div style={{ minWidth: 150 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: 5, color: '#999' }}>RESULTADO</label>
                        <select
                            value={filterResult}
                            onChange={e => setFilterResult(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px',
                                border: '1px solid #ddd',
                                borderRadius: 4,
                                fontSize: '14px',
                                background: 'white'
                            }}
                        >
                            <option value="all">Todos</option>
                            <option value="approved">Aprobadas</option>
                            <option value="rejected">Rechazadas</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                            <thead style={{ background: '#f4f4f4', borderBottom: '2px solid #111' }}>
                                <tr>
                                    <Th label="FECHA" sortKey="fecha" activeSort={sortConfig} onClick={requestSort} width="100px" />
                                    <Th label="TÍTULO / EXPEDIENTE" sortKey="texto_expediente" activeSort={sortConfig} onClick={requestSort} />
                                    <Th label="SESIÓN" sortKey="sesion" activeSort={sortConfig} onClick={requestSort} width="80px" />
                                    <Th label="VOTOS" width="200px" />
                                    <Th label="RESULTADO" sortKey="result" activeSort={sortConfig} onClick={requestSort} width="120px" />
                                </tr>
                            </thead>
                            <tbody>
                                {currentData.map((row, i) => (
                                    <tr key={i} onClick={() => handleRowClick(row)} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}>
                                        <td style={{ padding: '16px', color: '#666', whiteSpace: 'nowrap' }}>
                                            {row.fecha.toLocaleDateString('es-ES')}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.texto_expediente}</div>
                                            <div style={{ color: '#444', lineHeight: 1.4, fontSize: '12px' }}>{row.titulo_punto}</div>
                                        </td>
                                        <td style={{ padding: '16px', color: '#666' }}>
                                            {row.sesion}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <VoteBar aFavor={row.a_favor} enContra={row.en_contra} abst={row.abstenciones} />
                                            <div style={{ display: 'flex', gap: 10, fontSize: '11px', color: '#666', marginTop: 4 }}>
                                                <span style={{ color: '#4CAF50' }}>Sí: {row.a_favor}</span>
                                                <span style={{ color: '#F44336' }}>No: {row.en_contra}</span>
                                                <span style={{ color: '#999' }}>Abs: {row.abstenciones}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <StatusBadge status={row.result} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {filteredData.length === 0 && (
                        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>No se encontraron iniciativas.</div>
                    )}

                    {/* Show More Button */}
                    {hasMore && (
                        <div style={{ padding: '20px', textAlign: 'center', borderTop: '1px solid #eee' }}>
                            <button
                                onClick={handleShowMore}
                                style={{
                                    background: '#f4f4f4',
                                    border: '1px solid #ddd',
                                    padding: '10px 24px',
                                    borderRadius: '20px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    color: '#333',
                                    fontSize: '14px'
                                }}
                            >
                                Mostrar más iniciativas ({sortedData.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ marginTop: 20, textAlign: 'right', fontSize: '12px', color: '#999' }}>
                    Mostrando {Math.min(visibleCount, sortedData.length)} de {sortedData.length} registros
                </div>
                {/* Visual Modal */}
                {selectedInitiative && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                        background: 'rgba(0,0,0,0.6)', zIndex: 2000,
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        backdropFilter: 'blur(4px)'
                    }} onClick={() => setSelectedInitiative(null)}>
                        <div style={{
                            background: 'white',
                            width: '1000px',
                            height: '700px',
                            borderRadius: '12px',
                            padding: '40px',
                            overflowY: 'auto',
                            position: 'relative',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.2)'
                        }} onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => setSelectedInitiative(null)}
                                style={{
                                    position: 'absolute', top: 20, right: 20,
                                    background: '#f3f4f6', border: 'none', borderRadius: '50%',
                                    width: 36, height: 36, fontSize: 18, cursor: 'pointer'
                                }}
                            >✕</button>

                            <div style={{ marginBottom: 30 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', marginBottom: 8 }}>
                                    {selectedInitiative.fecha.toLocaleDateString()}
                                </div>
                                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, margin: '0 0 8px', lineHeight: 1.2 }}>
                                    {selectedInitiative.texto_expediente}
                                </h2>
                                <div style={{ fontSize: 14, color: '#666', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {selectedInitiative.titulo_punto}
                                    <StatusBadge status={selectedInitiative.result} />
                                </div>
                            </div>

                            {/* Gráfico de votaciones */}
                            {!votesLoading && votesMap && (
                                <VotesChart votes={getCurrentVotes()} />
                            )}

                            {/* Buscador del modal */}
                            <div style={{ marginBottom: 24 }}>
                                <input
                                    type="text"
                                    placeholder="Buscar por diputado o partido..."
                                    value={modalSearch}
                                    onChange={e => setModalSearch(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '12px 16px',
                                        border: '2px solid #e0e0e0',
                                        borderRadius: 8,
                                        fontSize: '14px',
                                        fontFamily: 'var(--font-sans)',
                                        transition: 'border-color 0.2s',
                                        outline: 'none'
                                    }}
                                    onFocus={e => e.target.style.borderColor = '#4CAF50'}
                                    onBlur={e => e.target.style.borderColor = '#e0e0e0'}
                                />
                            </div>

                            {votesLoading && !votesMap ? (
                                <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Cargando detalle de votación...</div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                                    <VoteList title="A FAVOR" votes={getCurrentVotes().si} color="#4CAF50" />
                                    <VoteList title="EN CONTRA" votes={getCurrentVotes().no} color="#F44336" />
                                    <VoteList title="ABSTENCIÓN" votes={getCurrentVotes().abs} color="#FF9800" />
                                    <VoteList title="NO VOTA" votes={getCurrentVotes().noVota} color="#999" />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatName(rawName) {
    if (!rawName) return "";
    const parts = rawName.split(",").map(s => s.trim());
    return parts.length === 2 ? parts[1] + " " + parts[0] : rawName;
}

function VoteList({ title, votes, color }) {
    return (
        <div style={{ background: '#f9f9f9', padding: 20, borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: color, borderBottom: `2px solid ${color}`, paddingBottom: 8, textTransform: 'uppercase' }}>
                {title} ({votes.length})
            </h3>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {votes.map((v, i) => (
                    <div key={i} style={{ fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: '#333' }}>{v.name}</span>
                        <span style={{ fontSize: 11, color: '#777', background: '#eee', padding: '2px 6px', borderRadius: 4 }}>{v.party}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Th({ label, sortKey, activeSort, onClick, width }) {
    const isActive = sortKey && activeSort && activeSort.key === sortKey && !activeSort.isDefault;
    const arrow = isActive ? (activeSort.direction === 'ascending' ? ' ↑' : ' ↓') : '';

    return (
        <th
            onClick={() => sortKey && onClick(sortKey)}
            style={{
                padding: '16px',
                cursor: sortKey ? 'pointer' : 'default',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                width: width || 'auto',
                color: isActive ? '#000' : '#666',
                fontWeight: 600,
                fontSize: '12px',
                letterSpacing: '0.5px'
            }}
        >
            {label}{arrow}
        </th>
    );
}

function VoteBar({ aFavor, enContra, abst }) {
    const total = aFavor + enContra + abst;
    if (!total) return null;

    const pctYes = (aFavor / total) * 100;
    const pctNo = (enContra / total) * 100;
    const pctAbs = (abst / total) * 100;

    return (
        <div style={{ width: '100%', height: '6px', background: '#eee', borderRadius: 3, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${pctYes}%`, background: '#4CAF50' }} />
            <div style={{ width: `${pctAbs}%`, background: '#bbb' }} />
            <div style={{ width: `${pctNo}%`, background: '#F44336' }} />
        </div>
    );
}

function StatusBadge({ status }) {
    const isApproved = status === 'Aprobada';
    return (
        <span style={{
            display: 'inline-block',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            background: isApproved ? '#e8f5e9' : '#ffebee',
            color: isApproved ? '#2e7d32' : '#c62828',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
        }}>
            {status}
        </span>
    );
}

function VotesChart({ votes }) {
    const svgRef = React.useRef();

    React.useEffect(() => {
        if (!svgRef.current) return;

        const data = [
            { label: 'A FAVOR', count: votes.si.length, color: '#4CAF50' },
            { label: 'EN CONTRA', count: votes.no.length, color: '#F44336' },
            { label: 'ABSTENCIÓN', count: votes.abs.length, color: '#FF9800' },
            { label: 'NO VOTA', count: votes.noVota.length, color: '#999' }
        ];

        const total = data.reduce((sum, d) => sum + d.count, 0);
        if (total === 0) return;

        const width = 900;
        const height = 120;
        const barHeight = 40;

        d3.select(svgRef.current).selectAll('*').remove();

        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('style', 'max-width: 100%; height: auto;');

        // Escala para el ancho de las barras
        const x = d3.scaleLinear()
            .domain([0, total])
            .range([0, width]);

        // Grupo para las barras
        const barGroup = svg.append('g')
            .attr('transform', `translate(0, ${(height - barHeight) / 2})`);

        let currentX = 0;

        // Dibujar segmentos de barra
        data.forEach((d, i) => {
            const segmentWidth = x(d.count);

            if (d.count > 0) {
                barGroup.append('rect')
                    .attr('x', currentX)
                    .attr('y', 0)
                    .attr('width', 0)
                    .attr('height', barHeight)
                    .attr('fill', d.color)
                    .attr('rx', i === 0 ? 6 : (i === data.length - 1 ? 6 : 0))
                    .transition()
                    .duration(800)
                    .delay(i * 100)
                    .attr('width', segmentWidth);

                // Etiqueta con porcentaje
                const percentage = ((d.count / total) * 100).toFixed(1);
                if (segmentWidth > 50) {
                    barGroup.append('text')
                        .attr('x', currentX + segmentWidth / 2)
                        .attr('y', barHeight / 2)
                        .attr('text-anchor', 'middle')
                        .attr('dominant-baseline', 'middle')
                        .attr('fill', 'white')
                        .attr('font-size', '14px')
                        .attr('font-weight', '700')
                        .attr('opacity', 0)
                        .text(`${d.count} (${percentage}%)`)
                        .transition()
                        .duration(400)
                        .delay(i * 100 + 400)
                        .attr('opacity', 1);
                }

                currentX += segmentWidth;
            }
        });

        // Leyenda debajo
        const legendY = height - 25;
        const legendSpacing = width / data.length;

        data.forEach((d, i) => {
            const legendX = i * legendSpacing + legendSpacing / 2;

            svg.append('circle')
                .attr('cx', legendX - 40)
                .attr('cy', legendY)
                .attr('r', 4)
                .attr('fill', d.color);

            svg.append('text')
                .attr('x', legendX - 30)
                .attr('y', legendY)
                .attr('dominant-baseline', 'middle')
                .attr('font-size', '11px')
                .attr('font-weight', '600')
                .attr('fill', '#666')
                .text(d.label);
        });

    }, [votes]);

    return (
        <div style={{ marginBottom: 24, background: '#fafafa', padding: '20px', borderRadius: 8 }}>
            <svg ref={svgRef}></svg>
        </div>
    );
}