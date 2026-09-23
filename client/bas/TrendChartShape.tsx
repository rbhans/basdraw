import { useEffect, useMemo, useRef } from 'react'
import { HTMLContainer, useColorMode, useEditor, useValue } from 'tldraw'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { useBasRuntime } from './BasRuntimeContext'
import { historySeriesKey } from './baskstreamSession'
import { DataShapeHeader, rangeLabel, type BasTrendShape } from './DataWidgetShapes'
import { dataWidgetContentStyle } from './dataWidgetSizing'

// Loaded lazily by the trend shape util so ECharts stays out of the main bundle.
echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, SVGRenderer])

export function TrendChartShape({ shape }: { shape: BasTrendShape }) {
	const { connected: stationConnected, stationAlias, historySeries, loadHistory } = useBasRuntime()
	const connected = stationConnected && stationAlias === shape.props.stationAlias
	const editor = useEditor()
	const colorMode = useColorMode()
	const editing = useValue('trend chart editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const chartElement = useRef<HTMLDivElement>(null)
	const chart = useRef<echarts.ECharts | null>(null)
	const seriesKey = shape.props.series.map((series) => series.pointReference).join('\n')

	// Depend on the point list, not the series array: a color or label edit must not refetch history.
	const pointReferences = useMemo(() => seriesKey ? seriesKey.split('\n') : [], [seriesKey])
	useEffect(() => {
		if (!connected) return
		for (const pointReference of pointReferences) void loadHistory(shape.id, pointReference, shape.props.rangeMs)
	}, [connected, loadHistory, pointReferences, shape.id, shape.props.rangeMs])

	const states = useMemo(
		() => pointReferences.map((pointReference) => connected ? historySeries[historySeriesKey(shape.id, pointReference)] : undefined),
		[connected, historySeries, pointReferences, shape.id],
	)
	const loading = states.some((state) => state?.loading)
	const error = states.find((state) => state?.error)?.error
	const pointCount = states.reduce((count, state) => count + (state?.records.length || 0), 0)

	useEffect(() => {
		const element = chartElement.current
		if (!element) return
		const instance = echarts.init(element, undefined, { renderer: 'svg' })
		chart.current = instance
		const observer = new ResizeObserver(() => instance.resize())
		observer.observe(element)
		return () => {
			observer.disconnect()
			instance.dispose()
			chart.current = null
		}
	}, [])

	useEffect(() => {
		const instance = chart.current
		const element = chartElement.current
		if (!instance || !element) return
		// ThemeSync updates the surrounding shell after the tldraw preference.
		// Resolve CSS colors on the next frame, once both theme classes agree.
		const frame = requestAnimationFrame(() => {
		const styles = getComputedStyle(element)
		const text = styles.getPropertyValue('--tl-color-text').trim() || (colorMode === 'dark' ? '#f1f1f1' : '#1d1d1d')
		const muted = styles.getPropertyValue('--tl-color-text-3').trim() || '#767676'
		const divider = styles.getPropertyValue('--tl-color-divider').trim() || '#dddddd'
		instance.setOption({
			animation: false,
			color: shape.props.series.map((series) => series.color),
			grid: { left: 46, right: 18, top: shape.props.series.length > 1 ? 34 : 16, bottom: 44, containLabel: false },
			legend: { show: shape.props.series.length > 1, top: 0, right: 14, textStyle: { color: muted, fontFamily: 'var(--tl-font-sans)', fontSize: 11 } },
			tooltip: {
				show: editing,
				trigger: 'axis',
				confine: true,
				backgroundColor: styles.getPropertyValue('--tl-color-panel').trim(),
				borderColor: divider,
				textStyle: { color: text, fontFamily: 'var(--tl-font-sans)', fontSize: 12 },
				valueFormatter: formatChartValue,
			},
			xAxis: { type: 'time', min: states.find((state) => state?.start)?.start, max: states.find((state) => state?.end)?.end, axisLine: { lineStyle: { color: divider } }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 10 }, splitLine: { show: false } },
			yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 10 }, splitLine: { lineStyle: { color: divider, type: 'dashed' } } },
			dataZoom: editing ? [{ type: 'inside', filterMode: 'none' }] : [],
			series: shape.props.series.map((series, index) => ({
				name: series.pointLabel,
				type: 'line',
				showSymbol: false,
				smooth: shape.props.lineMode === 'smooth' ? 0.22 : false,
				step: shape.props.lineMode === 'step' ? 'end' : false,
				lineStyle: { width: 2 },
				connectNulls: false,
				data: (states[index]?.records || [])
					.map((record) => [record.timestamp, numericHistoryValue(record.value)]),
			})),
		}, true)
		})
		return () => cancelAnimationFrame(frame)
	}, [colorMode, editing, pointCount, shape.props.lineMode, shape.props.series, states])

	return (
		<HTMLContainer
			className={`bas-data-shape ${editing ? 'is-inspecting' : ''}`}
			style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all' }}
			onPointerDown={editing ? (event) => event.stopPropagation() : undefined}
			onWheel={editing ? (event) => event.stopPropagation() : undefined}
		>
			<div className="bas-data-card bas-trend-card" style={dataWidgetContentStyle(shape.props.w, shape.props.h, shape.props.contentScale)}>
				<DataShapeHeader title={shape.props.title} detail={rangeLabel(shape.props.rangeMs)} state={connected ? loading ? 'loading' : error ? 'error' : 'history' : 'offline'} />
				<div className="bas-trend-chart" ref={chartElement} />
				{!connected && <div className="bas-chart-message">Connect to load history</div>}
				{connected && loading && pointCount === 0 && <div className="bas-chart-message">Loading history…</div>}
				{connected && error && pointCount === 0 && <div className="bas-chart-message is-error">{error}</div>}
				{connected && !loading && !error && pointCount === 0 && <div className="bas-chart-message">No numeric history in this range</div>}
				<div className="bas-chart-hint">{error && pointCount > 0 ? 'Some history could not load' : states.some((state) => (state?.records.length || 0) >= 2000) ? 'Sample limit reached · try a shorter range' : editing ? 'Scroll or drag to inspect · Escape to finish' : 'Double-click to inspect'}</div>
			</div>
		</HTMLContainer>
	)
}


function numericHistoryValue(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'boolean') return value ? 1 : 0
	const parsed = typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
	return Number.isFinite(parsed) ? parsed : null
}

function formatChartValue(value: unknown) {
	if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
	return String(value ?? '—')
}
