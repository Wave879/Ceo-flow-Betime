import React, { useMemo } from 'react';

// Pure SVG Pie Chart - no external libs
export function PieChart({ data = null, tasks = [], employees = [], centerLabel = 'งานทั้งหมด', centerValue }) {
    const chartState = useMemo(() => {
        if (Array.isArray(data)) {
            const normalizedRows = data
                .map((item, index) => ({
                    id: String(item?.id || item?.name || `slice-${index}`),
                    name: String(item?.name || `รายการ ${index + 1}`).trim(),
                    value: Math.max(0, Number(item?.value) || 0),
                    color: String(item?.color || '#94a3b8').trim() || '#94a3b8'
                }));

            const totalValue = normalizedRows.reduce((sum, item) => sum + item.value, 0);
            const denominator = totalValue || 1;
            let cumulative = 0;
            const slices = normalizedRows
                .filter((item) => item.value > 0)
                .map((item) => {
                    const pct = item.value / denominator;
                    const slice = { ...item, pct, cumulative };
                    cumulative += pct;
                    return slice;
                });

            return {
                slices,
                total: totalValue,
                center: centerValue ?? totalValue
            };
        }

        if (!Array.isArray(tasks) || !Array.isArray(employees)) {
            return {
                slices: [],
                total: 0,
                center: centerValue ?? 0
            };
        }

        const totals = {};
        employees.forEach((employee) => { totals[employee.id] = 0; });
        tasks.forEach((task) => {
            task.assignees?.forEach((employeeId) => {
                if (totals[employeeId] !== undefined) {
                    totals[employeeId] += 1;
                }
            });
        });

        const totalValue = Object.values(totals).reduce((sum, value) => sum + value, 0);
        const denominator = totalValue || 1;
        let cumulative = 0;
        const slices = employees
            .filter((employee) => totals[employee.id] > 0)
            .map((employee) => {
                const pct = totals[employee.id] / denominator;
                const slice = {
                    id: employee.id,
                    name: employee.name,
                    value: totals[employee.id],
                    pct,
                    color: employee.color,
                    cumulative
                };
                cumulative += pct;
                return slice;
            });

        return {
            slices,
            total: totalValue,
            center: centerValue ?? tasks.length
        };
    }, [centerValue, data, employees, tasks]);

    // Polar to cartesian
    const polarToCartesian = (cx, cy, r, angle) => ({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
    });

    const describeArc = (cx, cy, r, startPct, endPct) => {
        const start = polarToCartesian(cx, cy, r, (startPct * 2 * Math.PI) - Math.PI / 2);
        const end = polarToCartesian(cx, cy, r, (endPct * 2 * Math.PI) - Math.PI / 2);
        const largeArc = endPct - startPct > 0.5 ? 1 : 0;
        return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
    };

    const getLabelPos = (cumulative, pct, cx, cy, r) => {
        const midPct = cumulative + pct / 2;
        const angle = (midPct * 2 * Math.PI) - Math.PI / 2;
        return {
            x: cx + (r + 22) * Math.cos(angle),
            y: cy + (r + 22) * Math.sin(angle),
        };
    };

    const cx = 150, cy = 150, r = 100;
    const hasSingleSlice = chartState.slices.length <= 1;

    return (
        <div className="w-full h-full">
            <svg className="w-full h-full" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
                {chartState.slices.map((slice) => {
                    const labelPos = getLabelPos(slice.cumulative, slice.pct, cx, cy, r);
                    const midAngle = ((slice.cumulative + slice.pct / 2) * 2 * Math.PI) - Math.PI / 2;
                    const labelAnchor = labelPos.x > cx ? 'start' : 'end';
                    const shouldRenderOuterLabel = !hasSingleSlice && slice.pct >= 0.08 && slice.pct < 0.9;
                    // line from slice edge to label
                    const lineStart = {
                        x: cx + (r + 4) * Math.cos(midAngle),
                        y: cy + (r + 4) * Math.sin(midAngle),
                    };
                    return (
                        <g key={slice.id} className="group cursor-pointer">
                            <path
                                d={describeArc(cx, cy, r, slice.cumulative, slice.cumulative + slice.pct)}
                                fill={slice.color}
                                stroke="white"
                                strokeWidth="2"
                                className="transition-all duration-200 group-hover:opacity-80"
                                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }}
                            />
                            {shouldRenderOuterLabel && (
                                <>
                                    <line
                                        x1={lineStart.x} y1={lineStart.y}
                                        x2={labelPos.x - (labelAnchor === 'start' ? 4 : -4)}
                                        y2={labelPos.y}
                                        stroke={slice.color} strokeWidth="1.5" opacity="0.7"
                                    />
                                    <text
                                        x={labelPos.x}
                                        y={labelPos.y - 6}
                                        textAnchor={labelAnchor}
                                        fontSize="10"
                                        fontWeight="600"
                                        fill={slice.color}
                                        fontFamily="Kanit, sans-serif"
                                    >
                                        {slice.name.split(' ')[0]}
                                    </text>
                                    <text
                                        x={labelPos.x}
                                        y={labelPos.y + 7}
                                        textAnchor={labelAnchor}
                                        fontSize="9"
                                        fill="#64748b"
                                        fontFamily="Kanit, sans-serif"
                                    >
                                        {Math.round(slice.pct * 100)}%
                                    </text>
                                </>
                            )}
                        </g>
                    );
                })}
                {chartState.slices.length === 0 && (
                    <circle cx={cx} cy={cy} r={r} fill="rgba(148,163,184,0.12)" />
                )}
                {/* Center circle (donut hole) */}
                <circle cx={cx} cy={cy} r={52} className="fill-white dark:fill-slate-900 transition-colors" />
                <text x={cx} y={cy - 8} textAnchor="middle" fontSize="11" className="fill-slate-500 dark:fill-slate-400 font-medium transition-colors" fontFamily="Kanit, sans-serif">{centerLabel}</text>
                <text x={cx} y={cy + 14} textAnchor="middle" fontSize="22" className="fill-slate-800 dark:fill-slate-200 font-extrabold transition-colors" fontFamily="Kanit, sans-serif">
                    {chartState.center}
                </text>
            </svg>
        </div>
    );
}

export function WorkloadRanking({ tasks = [], employees = [] }) {
    const workloads = useMemo(() => {
        if (!Array.isArray(tasks) || !Array.isArray(employees)) {
            return [];
        }

        return employees.map(e => ({
            ...e,
            count: tasks.filter(t => t.assignees?.includes(e.id)).length,
        }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }, [tasks, employees]);

    const maxCount = Math.max(...workloads.map(w => w.count), 1);

    return (
        <div className="space-y-3">
            {workloads.map((w, i) => (
                <div key={w.id} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-400 w-5 text-right">{i + 1}</span>
                    <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: w.color }}
                    >
                        {w.name.split(' ')[0][0]}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate transition-colors">{w.name.split(' ')[0]}</span>
                            <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: w.color }}>{w.count} งาน</span>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden transition-colors">
                            <div
                                className="h-full rounded-full progress-fill transition-all duration-700"
                                style={{
                                    width: `${(w.count / maxCount) * 100}%`,
                                    background: `linear-gradient(90deg, ${w.color}, ${w.color}bb)`,
                                }}
                            />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
