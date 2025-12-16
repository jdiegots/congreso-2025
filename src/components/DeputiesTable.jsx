import React, { useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import diputadosData from '../../public/data/diputados.json';
import partidosData from '../../public/data/partidos.json';
import gparData from '../../public/data/gpar.json';

const parseInterventionDuration = (str) => {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1]; // Assuming H:MM based on analysis
    }
    return 0;
};

const normalizeStr = (str) => {
    return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
};

const cleanCsvName = (name) => {
    if (!name) return "";
    return name.replace(/\s*\([^)]*\)$/, '').trim(); // Remove (Parti)
};

const formatTimeDisplay = (totalMinutes) => {
    if (!totalMinutes) return "-";
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0 && m === 0) return "-";
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

export default function DeputiesTable({ onBack }) {
    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState(null);
    const [filterGrupo, setFilterGrupo] = useState('all');
    const [filterGobierno, setFilterGobierno] = useState('all');
    const [votesData, setVotesData] = useState({});
    const [loadingVotes, setLoadingVotes] = useState(true);

    // Modal State
    const [selectedDeputy, setSelectedDeputy] = useState(null);
    const [imgError, setImgError] = useState(false);

    // Reset image error when opening a new deputy
    useEffect(() => {
        if (selectedDeputy) {
            setImgError(false);
        }
    }, [selectedDeputy]);

    // Crear mapas de datos
    const partidoMap = useMemo(() => {
        const map = {};
        partidosData.forEach(p => {
            map[p.siglas] = p;
        });
        return map;
    }, []);

    const gparMap = useMemo(() => {
        const map = {};
        gparData.forEach(g => {
            map[g.nombre] = g;
        });
        return map;
    }, []);

    // Load Votes Data in Background
    useEffect(() => {
        let isMounted = true;
        setLoadingVotes(true);

        const loadData = async () => {
            try {
                // 1. Cargar metadatos de votaciones
                const votaciones = await d3.csv('/data/out_votaciones/votaciones.csv');
                const metaMap = {};
                votaciones.forEach(v => {
                    // Use 'id' column to match with votacion_id in votes CSV
                    metaMap[v.id] = {
                        titulo: v.titulo_punto || "Votación sin título",
                        texto: v.texto_expediente,
                        fecha: v.fecha,
                        sesion: v.sesion,
                        resultado: {
                            a_favor: v.a_favor,
                            en_contra: v.en_contra,
                            abstenciones: v.abstenciones
                        }
                    };
                });
                console.log(`Metadatos cargados: ${Object.keys(metaMap).length} votaciones.`);

                // 2. Cargar votos individuales (chunks)
                const summaryRes = await fetch("/data/out_votaciones/summary.json");
                if (!summaryRes.ok) throw new Error("No se pudo cargar summary.json");
                const summary = await summaryRes.json();
                const chunkFiles = summary.votos_chunks || [];

                console.log(`Cargando ${chunkFiles.length} chunks de votos...`);

                const chunks = await Promise.all(
                    chunkFiles.map(f => d3.csv(`/data/out_votaciones/${f}`))
                );

                const votos = chunks.flat();

                if (!isMounted) return;

                console.log("Total de votos cargados:", votos.length);
                const map = {};

                if (votos.length === 0) {
                    setLoadingVotes(false);
                    return;
                }

                // Detectar nombres de columna
                const keys = Object.keys(votos[0]);
                const idKey = keys.find(k => k === 'diputado_id');
                const deputyKey = keys.find(k => k === 'diputado_xml') || 'diputado';
                const voteKey = keys.find(k => k.trim().toLowerCase() === 'voto') || 'voto';

                votos.forEach(row => {
                    const uid = row.votacion_uid || row.votacion_id;
                    const meta = metaMap[uid] || {};

                    const voteItem = {
                        titulo: meta.titulo || "Votación",
                        texto: meta.texto,
                        fecha: meta.fecha,
                        sesion: meta.sesion,
                        resultado_global: meta.resultado,
                        voto: row[voteKey],
                        id: uid
                    };

                    // Map by ID
                    if (idKey && row[idKey]) {
                        const id = String(row[idKey]);
                        if (!map[id]) map[id] = [];
                        map[id].push(voteItem);
                    }

                    // Map by name (fallback/support)
                    const rawName = row[deputyKey];
                    if (rawName) {
                        const name = normalizeStr(rawName);
                        if (!map[name]) map[name] = [];
                        map[name].push(voteItem);
                    }
                });

                setVotesData(map);
            } catch (err) {
                console.error("Error loading votes:", err);
            } finally {
                if (isMounted) setLoadingVotes(false);
            }
        };

        // Pequeño delay para no bloquear render inicial
        setTimeout(loadData, 100);

        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        // Load interventions CSV
        d3.dsv(";", "/data/intervenciones_con_grupo.csv").then(intervenciones => {
            // Process interventions map
            const intMap = {}; // normalized_name -> { count, minutes }

            intervenciones.forEach(row => {
                if (!row.ORADOR) return;
                const clean = cleanCsvName(row.ORADOR);
                const norm = normalizeStr(clean);

                if (!intMap[norm]) intMap[norm] = { count: 0, minutes: 0 };

                intMap[norm].count++;
                intMap[norm].minutes += parseInterventionDuration(row.DURACION);
            });

            // Procesar datos de diputados - solo los que tienen asiento y grupo parlamentario
            const processed = diputadosData
                .filter(d => d.asiento && d.asiento !== "-1" && d.g_par && d.g_par.trim().length > 0)  // Solo diputados con asiento válido y grupo parlamentario
                .map(d => {
                    const matchKey = normalizeStr(d.nombre);
                    const stats = intMap[matchKey] || { count: 0, minutes: 0 };

                    return {
                        ...d,
                        nombreFormateado: formatName(d.nombre),
                        partidoData: partidoMap[d.partido] || {},
                        gparData: gparMap[d.g_par] || {},
                        enGobierno: d.gobierno === "1",
                        interventionsCount: stats.count, // Nº Intervenciones
                        interventionsMinutes: stats.minutes // Tiempo minutos
                    };
                });

            console.log('Total diputados procesados:', processed.length);
            setData(processed);
            setLoading(false);
        });
    }, [partidoMap, gparMap]);

    // Obtener grupos únicos para filtro
    const gruposUnicos = useMemo(() => {
        const grupos = [...new Set(data.map(d => d.g_par))].filter(Boolean);
        return grupos.sort();
    }, [data]);

    // Filtering
    const filteredData = useMemo(() => {
        return data.filter(item => {
            const matchSearch = (
                item.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.partido.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.g_par.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.circunscripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (partidoMap[item.partido]?.nombre || '').toLowerCase().includes(searchTerm.toLowerCase())
            );

            const matchGrupo = filterGrupo === 'all' ? true : item.g_par === filterGrupo;
            const matchGobierno = filterGobierno === 'all' ? true :
                (filterGobierno === 'yes' ? item.enGobierno : !item.enGobierno);

            return matchSearch && matchGrupo && matchGobierno;
        });
    }, [data, searchTerm, filterGrupo, filterGobierno, partidoMap]);

    // Sorting
    const sortedData = useMemo(() => {
        let sortable = [...filteredData];

        if (sortConfig === null) {
            // Orden por defecto: Tiempo intervención (desc) > Nº Intervenciones (desc)
            sortable.sort((a, b) => {
                if (b.interventionsMinutes !== a.interventionsMinutes) {
                    return b.interventionsMinutes - a.interventionsMinutes;
                }
                return b.interventionsCount - a.interventionsCount;
            });
        } else {
            sortable.sort((a, b) => {
                let aVal = a[sortConfig.key];
                let bVal = b[sortConfig.key];

                // Manejar casos especiales
                if (sortConfig.key === 'nombreFormateado') {
                    aVal = a.nombreFormateado;
                    bVal = b.nombreFormateado;
                }

                if (aVal < bVal) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aVal > bVal) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }

                // Desempate si se ordena explícitamente por tiempo
                if (sortConfig.key === 'interventionsMinutes') {
                    return b.interventionsCount - a.interventionsCount;
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

    const [visibleCount, setVisibleCount] = useState(20);

    // Reset pagination when filters change
    useEffect(() => {
        setVisibleCount(20);
    }, [searchTerm, filterGrupo, filterGobierno, sortConfig]);

    const handleShowMore = () => {
        setVisibleCount(prev => prev + 20);
    };

    const handleRowClick = (deputy) => {
        setSelectedDeputy(deputy);
    };

    // Bloquear scroll cuando el modal está abierto
    useEffect(() => {
        if (selectedDeputy) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [selectedDeputy]);

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
            <div style={{ maxWidth: 1400, margin: '0 auto' }}>
                {/* Header */}
                <div style={{ marginBottom: 40 }}>
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
                        Diputados en el Congreso en 2025
                    </h1>
                    <p style={{ color: '#666', marginTop: 10 }}>
                        Explora todos los diputados activos en el Congreso de los Diputados.
                    </p>
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
                            placeholder="Buscar por nombre, partido, grupo o circunscripción..."
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
                    <div style={{ minWidth: 200 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: 5, color: '#999' }}>GRUPO PARLAMENTARIO</label>
                        <select
                            value={filterGrupo}
                            onChange={e => setFilterGrupo(e.target.value)}
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
                            {gruposUnicos.map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ minWidth: 150 }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: 5, color: '#999' }}>GOBIERNO</label>
                        <select
                            value={filterGobierno}
                            onChange={e => setFilterGobierno(e.target.value)}
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
                            <option value="yes">Sí</option>
                            <option value="no">No</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                            <thead style={{ background: '#f4f4f4', borderBottom: '2px solid #111' }}>
                                <tr>
                                    <Th label="DIPUTADO" width="60px" />
                                    <Th label="" sortKey="nombreFormateado" activeSort={sortConfig} onClick={requestSort} />
                                    <Th label="PARTIDO" sortKey="partido" activeSort={sortConfig} onClick={requestSort} width="120px" />
                                    <Th label="GRUPO PARLAMENTARIO" sortKey="g_par" activeSort={sortConfig} onClick={requestSort} width="160px" />
                                    <Th label="CIRCUNSCRIPCIÓN" sortKey="circunscripcion" activeSort={sortConfig} onClick={requestSort} width="130px" />
                                    <Th label="TIEMPO" sortKey="interventionsMinutes" activeSort={sortConfig} onClick={requestSort} width="100px" />
                                    <Th label="Nº INTERVENCIONES" sortKey="interventionsCount" activeSort={sortConfig} onClick={requestSort} width="80px" />
                                    <Th label="GOBIERNO" sortKey="gobierno" activeSort={sortConfig} onClick={requestSort} width="60px" />
                                </tr>
                            </thead>
                            <tbody>
                                {currentData.map((row, i) => (
                                    <tr key={row.id} onClick={() => handleRowClick(row)} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}>
                                        <td style={{ padding: '12px', textAlign: 'center' }}>
                                            {row.img ? (
                                                <img
                                                    src={`/images/diputados_img/${row.img}`}
                                                    alt={row.nombre}
                                                    style={{
                                                        width: 48,
                                                        height: 48,
                                                        borderRadius: '50%',
                                                        objectFit: 'cover',
                                                        border: '2px solid #e0e0e0'
                                                    }}
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            ) : (
                                                <div style={{
                                                    width: 48,
                                                    height: 48,
                                                    borderRadius: '50%',
                                                    background: '#e0e0e0',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '18px',
                                                    fontWeight: 600,
                                                    color: '#999'
                                                }}>
                                                    {row.nombreFormateado.charAt(0)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ fontWeight: 600 }}>{row.nombreFormateado}</div>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{
                                                background: `#${row.partidoData.color || 'ccc'}`,
                                                color: 'white',
                                                padding: '4px 8px',
                                                borderRadius: 4,
                                                fontSize: '12px',
                                                fontWeight: 600
                                            }}>
                                                {row.partido}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '13px', color: '#666' }}>
                                            {row.g_par}
                                        </td>
                                        <td style={{ padding: '16px', color: '#666' }}>
                                            {row.circunscripcion}
                                        </td>
                                        <td style={{ padding: '16px', color: '#333', fontWeight: 500 }}>
                                            {formatTimeDisplay(row.interventionsMinutes)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center', color: '#666' }}>
                                            {row.interventionsCount > 0 ? row.interventionsCount : '-'}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center' }}>
                                            {row.enGobierno ? '✓' : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {filteredData.length === 0 && (
                        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>No se encontraron diputados.</div>
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
                                Mostrar más diputados ({sortedData.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ marginTop: 20, textAlign: 'right', fontSize: '12px', color: '#999' }}>
                    Mostrando {Math.min(visibleCount, sortedData.length)} de {sortedData.length} registros
                </div>

                {/* Modal - Window Style with Deputy Card Design */}
                {selectedDeputy && (
                    <div style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        zIndex: 2000,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        backdropFilter: 'blur(4px)',
                        padding: '20px'
                    }} onClick={() => setSelectedDeputy(null)}>

                        <div className="deputy-card" style={{
                            backgroundColor: 'white',
                            borderRadius: '24px',
                            padding: '40px',
                            width: '100%',
                            maxWidth: '800px',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                            position: 'relative',
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px',
                            maxHeight: '90vh',
                            overflowY: 'auto'
                        }} onClick={e => e.stopPropagation()}>

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
                                width: '100px',
                                height: '100px',
                                minHeight: '100px', // Prevent collapse
                                flex: '0 0 100px', // Prevent flex shrinking
                                borderRadius: '50%',
                                overflow: 'hidden',
                                marginBottom: '16px',
                                marginTop: '8px',
                                border: '3px solid #f3f4f6',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                position: 'relative',
                                backgroundColor: '#e0e0e0'
                            }}>
                                {!imgError && selectedDeputy.img ? (
                                    <img
                                        key={selectedDeputy.img}
                                        src={`/images/diputados_img/${selectedDeputy.img}?v=2`}
                                        alt={selectedDeputy.nombre}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                        onError={(e) => {
                                            console.warn("Image load failed:", e.target.src);
                                            setImgError(true);
                                        }}
                                    />
                                ) : (
                                    <div style={{
                                        width: '100%',
                                        height: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '40px',
                                        fontWeight: 600,
                                        color: '#999'
                                    }}>
                                        {selectedDeputy.nombreFormateado.charAt(0)}
                                    </div>
                                )}
                            </div>

                            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '32px', margin: '0 0 8px', color: '#111', lineHeight: 1.1 }}>
                                {selectedDeputy.nombreFormateado}
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <p style={{ margin: 0, color: '#4b5563', fontSize: '18px' }}>
                                    {selectedDeputy.trato} por <strong>{selectedDeputy.circunscripcion}</strong>
                                </p>
                                <p style={{ margin: 0, color: '#111827', fontWeight: 600, fontSize: '18px' }}>
                                    {partidoMap[selectedDeputy.partido]?.nombre || selectedDeputy.partido}
                                </p>
                                <div style={{
                                    margin: '16px 0 0',
                                    paddingTop: '16px',
                                    borderTop: '1px solid #f3f4f6',
                                    width: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    alignItems: 'center'
                                }}>
                                    <p style={{ margin: 0, color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                                        Grupo Parlamentario
                                    </p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                        <span style={{ color: '#111', fontSize: '16px', lineHeight: 1.4 }}>
                                            {selectedDeputy.g_par}
                                        </span>
                                        {selectedDeputy.enGobierno && (
                                            <span style={{
                                                background: '#dcfce7',
                                                color: '#166534',
                                                padding: '4px 10px',
                                                borderRadius: '20px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                whiteSpace: 'nowrap',
                                                letterSpacing: '0.02em',
                                                border: '1px solid #bbf7d0'
                                            }}>
                                                Miembro del Gobierno
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    gap: '12px',
                                    marginTop: '24px',
                                    width: '100%',
                                    justifyContent: 'center'
                                }}>
                                    <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '16px', flex: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                        <div style={{ fontSize: '20px', fontWeight: 800, color: '#111', lineHeight: '1.2', marginBottom: '4px' }}>
                                            {formatTimeDisplay(selectedDeputy.interventionsMinutes)}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tiempo total</div>
                                    </div>
                                    <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '16px', flex: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                        <div style={{ fontSize: '20px', fontWeight: 800, color: '#111', lineHeight: '1.2', marginBottom: '4px' }}>
                                            {selectedDeputy.interventionsCount || 0}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Intervenciones</div>
                                    </div>
                                </div>

                                {/* Ficha / Biografía */}
                                {selectedDeputy.biografia && (
                                    <div style={{ marginTop: '5px', width: '100%', textAlign: 'left' }}>
                                        <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px', color: '#111', paddingBottom: '10px', borderBottom: '1px solid #e5e7eb' }}>
                                            Ficha
                                        </h4>
                                        <p style={{
                                            fontFamily: 'var(--font-sans)',
                                            fontSize: '16px',
                                            lineHeight: '1.6',
                                            color: '#374151',
                                            marginTop: 0,
                                            whiteSpace: 'pre-line'
                                        }}>
                                            {selectedDeputy.biografia}
                                        </p>
                                    </div>
                                )}

                                {/* Voting History */}
                                <div style={{ marginTop: '40px', width: '100%', textAlign: 'left' }}>
                                    <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px', color: '#111', paddingBottom: '10px', borderBottom: '1px solid #e5e7eb' }}>
                                        Historial de votaciones
                                    </h4>

                                    {loadingVotes ? (
                                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
                                            Cargando historial...
                                        </div>
                                    ) : (
                                        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
                                            {(() => {
                                                const history = votesData[String(selectedDeputy.id)] || votesData[normalizeStr(selectedDeputy.nombre)];

                                                if (history && history.length > 0) {
                                                    return (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {history.map((v, idx) => (
                                                                <div key={idx} style={{
                                                                    padding: '16px',
                                                                    background: '#f9fafb',
                                                                    borderRadius: '12px',
                                                                    display: 'flex',
                                                                    flexDirection: 'column',
                                                                    gap: '8px',
                                                                    fontSize: '14px',
                                                                    border: '1px solid #f3f4f6'
                                                                }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                                                        <span style={{ color: '#111', fontWeight: 600, flex: 1, fontSize: '15px', lineHeight: '1.4' }}>
                                                                            {v.titulo}
                                                                        </span>
                                                                        <span style={{
                                                                            fontWeight: 700,
                                                                            fontSize: '13px',
                                                                            color: v.voto === 'Sí' ? '#15803d' : (v.voto === 'No' ? '#b91c1c' : '#a16207'),
                                                                            padding: '4px 10px',
                                                                            background: v.voto === 'Sí' ? '#dcfce7' : (v.voto === 'No' ? '#fee2e2' : '#fef9c3'),
                                                                            borderRadius: '6px',
                                                                            textAlign: 'center',
                                                                            whiteSpace: 'nowrap',
                                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                                        }}>
                                                                            {v.voto}
                                                                        </span>
                                                                    </div>

                                                                    {v.texto && (
                                                                        <div style={{
                                                                            fontSize: '13px',
                                                                            color: '#4b5563',
                                                                            lineHeight: 1.5,
                                                                            display: '-webkit-box',
                                                                            WebkitLineClamp: 3,
                                                                            WebkitBoxOrient: 'vertical',
                                                                            overflow: 'hidden'
                                                                        }}>
                                                                            {v.texto}
                                                                        </div>
                                                                    )}

                                                                    {v.resultado_global && (
                                                                        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                                                                            <div style={{ marginBottom: '6px' }}>
                                                                                <VoteBar
                                                                                    aFavor={v.resultado_global.a_favor}
                                                                                    enContra={v.resultado_global.en_contra}
                                                                                    abst={v.resultado_global.abstenciones}
                                                                                />
                                                                            </div>
                                                                            <div style={{ display: 'flex', gap: 12, fontSize: '11px', fontWeight: 600 }}>
                                                                                <span style={{ color: '#16a34a' }}>Sí: {v.resultado_global.a_favor}</span>
                                                                                <span style={{ color: '#dc2626' }}>No: {v.resultado_global.en_contra}</span>
                                                                                <span style={{ color: '#9ca3af' }}>Abs: {v.resultado_global.abstenciones}</span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    );
                                                } else {
                                                    return (
                                                        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                                                            No hay datos de votación disponibles para este diputado.
                                                        </div>
                                                    );
                                                }
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>
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




function Th({ label, sortKey, activeSort, onClick, width }) {
    const isActive = sortKey && activeSort && activeSort.key === sortKey;
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
    const safeFavor = Number(aFavor) || 0;
    const safeContra = Number(enContra) || 0;
    const safeAbst = Number(abst) || 0;
    const total = safeFavor + safeContra + safeAbst;

    if (!total) return null;

    const pctYes = (safeFavor / total) * 100;
    const pctNo = (safeContra / total) * 100;
    const pctAbs = (safeAbst / total) * 100;

    return (
        <div style={{ width: '100%', height: '6px', background: '#eee', borderRadius: 3, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${pctYes}%`, background: '#4CAF50' }} />
            <div style={{ width: `${pctAbs}%`, background: '#bbb' }} />
            <div style={{ width: `${pctNo}%`, background: '#F44336' }} />
        </div>
    );
}
