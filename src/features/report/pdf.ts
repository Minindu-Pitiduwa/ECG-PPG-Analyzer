import type { jsPDF } from 'jspdf';
import type { Poincare } from '@/dsp/hrv/poincare';
import { extent } from '@/dsp/util/decimate';
import { formatTime } from '@/lib/format';
import type { MetricRow, ReportModel, Row } from './reportModel';

/** The data behind the report's plots. Drawn as vector graphics, so they stay sharp in print. */
export interface ReportCharts {
  /** A stretch of the filtered signal, already thinned for drawing, with the beats inside it. */
  signal: {
    timeS: Float64Array;
    values: Float64Array;
    fromS: number;
    toS: number;
    units: string;
    beats: { timeS: number; value: number; flagged: boolean }[];
  };
  /** One point per beat-to-beat interval. */
  intervals: { timeS: Float64Array; bpm: Float64Array; ms: Float64Array; excluded: boolean[] };
  poincare: Poincare;
  durationS: number;
  rateLabel: string;
}

// A4 portrait, millimetres.
const PAGE = { width: 210, height: 297, margin: 15 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const FOOTER_HEIGHT = 12;
const POINT_TO_MM = 0.3528;
const LINE_SPACING = 1.3;

type Rgb = readonly [number, number, number];
/** The same colorblind-safe palette as the app's light theme. */
const COLOR = {
  text: [15, 23, 42],
  muted: [82, 96, 119],
  rule: [203, 213, 225],
  panel: [241, 245, 249],
  signal: [0, 114, 178],
  beat: [230, 159, 0],
  flagged: [213, 94, 0],
} as const satisfies Record<string, Rgb>;

/** Plots with more points than this are thinned; beyond it the extra detail is invisible on paper. */
const MAX_PLOT_POINTS = 1500;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Keeps track of the writing position and starts a new page when a block would not fit. */
class Layout {
  y = PAGE.margin;

  constructor(readonly doc: jsPDF) {}

  /** Make sure `height` mm fit on the current page, moving to a new one if not. */
  reserve(height: number): void {
    if (this.y + height > PAGE.height - PAGE.margin - FOOTER_HEIGHT) {
      this.doc.addPage();
      this.y = PAGE.margin;
    }
  }

  font(size: number, style: 'normal' | 'bold' = 'normal', color: Rgb = COLOR.text): void {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  lineHeight(size: number): number {
    return size * POINT_TO_MM * LINE_SPACING;
  }

  /** Write wrapped text at the given position and return the height it used. */
  paragraph(text: string, x: number, y: number, width: number, size: number): number {
    const lines = this.doc.splitTextToSize(text, width) as string[];
    this.doc.text(lines, x, y + size * POINT_TO_MM);
    return lines.length * this.lineHeight(size);
  }

  /**
   * @param following height of the block that must stay on the same page as the heading,
   *   so a heading is never left alone at the foot of a page
   */
  heading(text: string, following = 6): void {
    this.reserve(8.5 + following);
    this.font(11, 'bold');
    this.doc.text(text, PAGE.margin, this.y + 4);
    this.doc.setDrawColor(...COLOR.rule);
    this.doc.setLineWidth(0.2);
    this.doc.line(PAGE.margin, this.y + 5.5, PAGE.width - PAGE.margin, this.y + 5.5);
    this.y += 8.5;
  }
}

/** A two-column list of labels and values; returns the height used. */
function drawRows(layout: Layout, rows: Row[], x: number, y: number, width: number): number {
  const labelWidth = 32;
  let offset = 0;
  for (const [label, value] of rows) {
    layout.font(8, 'normal', COLOR.muted);
    layout.doc.text(label, x, y + offset + 8 * POINT_TO_MM);
    layout.font(8);
    offset +=
      Math.max(layout.paragraph(value, x + labelWidth, y + offset, width - labelWidth, 8), 3.6) +
      0.6;
  }
  return offset;
}

function drawMetricGroup(
  layout: Layout,
  group: string,
  rows: MetricRow[],
  note: string | undefined,
  x: number,
  width: number,
): void {
  layout.reserve(8 + 4.4 * rows.length);
  layout.font(9, 'bold');
  layout.doc.text(group, x, layout.y + 3.2);
  layout.y += 5;
  for (const row of rows) {
    layout.font(8.5, 'normal', COLOR.muted);
    layout.doc.text(row.label, x, layout.y + 3);
    layout.font(8.5, 'bold');
    layout.doc.text(row.value, x + width - 12, layout.y + 3, { align: 'right' });
    layout.font(8, 'normal', COLOR.muted);
    layout.doc.text(row.unit, x + width - 10.5, layout.y + 3);
    layout.y += 4.4;
  }
  if (note) {
    layout.font(7.5, 'normal', COLOR.muted);
    layout.y += layout.paragraph(note, x, layout.y, width, 7.5);
  }
  layout.y += 3;
}

/** Draw a plot frame with a title and the ends of both axes labelled. */
function drawFrame(
  layout: Layout,
  box: Box,
  title: string,
  xRange: [string, string],
  yRange: [string, string],
): void {
  const { doc } = layout;
  layout.font(8.5, 'bold');
  doc.text(title, box.x, box.y - 1.5);
  doc.setDrawColor(...COLOR.rule);
  doc.setLineWidth(0.2);
  doc.rect(box.x, box.y, box.width, box.height);
  layout.font(7, 'normal', COLOR.muted);
  doc.text(xRange[0], box.x, box.y + box.height + 3);
  doc.text(xRange[1], box.x + box.width, box.y + box.height + 3, { align: 'right' });
  doc.text(yRange[1], box.x - 1, box.y + 2.2, { align: 'right' });
  doc.text(yRange[0], box.x - 1, box.y + box.height, { align: 'right' });
}

interface Scale {
  x: (value: number) => number;
  y: (value: number) => number;
}

function scaleFor(
  box: Box,
  xRange: [number, number],
  yRange: [number, number],
  inset = 1.5,
): Scale {
  const xSpan = xRange[1] - xRange[0] || 1;
  const ySpan = yRange[1] - yRange[0] || 1;
  return {
    x: (value) => box.x + ((value - xRange[0]) / xSpan) * box.width,
    y: (value) =>
      box.y + box.height - inset - ((value - yRange[0]) / ySpan) * (box.height - 2 * inset),
  };
}

/** Draw a connected line through the points, thinning them if there are very many. */
function drawLine(
  doc: jsPDF,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  scale: Scale,
  color: Rgb,
): void {
  if (xs.length < 2) return;
  const stride = Math.ceil(xs.length / MAX_PLOT_POINTS);
  const points: [number, number][] = [];
  for (let i = 0; i < xs.length; i += stride) points.push([scale.x(xs[i]), scale.y(ys[i])]);
  // jsPDF draws a path from a start point and a list of steps relative to the previous point.
  const steps = points.slice(1).map(([px, py], i) => [px - points[i][0], py - points[i][1]]);
  doc.setDrawColor(...color);
  doc.setLineWidth(0.18);
  doc.lines(steps, points[0][0], points[0][1], [1, 1], 'S');
}

function drawDot(doc: jsPDF, x: number, y: number, radius: number, color: Rgb): void {
  doc.setFillColor(...color);
  doc.circle(x, y, radius, 'F');
}

function drawSignal(layout: Layout, charts: ReportCharts): void {
  const { signal } = charts;
  const box: Box = { x: PAGE.margin + 10, y: layout.y + 5, width: CONTENT_WIDTH - 10, height: 40 };
  const [lo, hi] = extent(signal.values);
  drawFrame(
    layout,
    box,
    `Filtered signal, ${formatTime(signal.fromS)} to ${formatTime(signal.toS)} (${signal.units})`,
    [formatTime(signal.fromS), formatTime(signal.toS)],
    [lo.toFixed(2), hi.toFixed(2)],
  );
  const scale = scaleFor(box, [signal.fromS, signal.toS], [lo, hi]);
  drawLine(layout.doc, signal.timeS, signal.values, scale, COLOR.signal);
  // Markers would merge into a band when a long stretch is shown; the line alone is clearer then.
  if (signal.beats.length <= 80) {
    for (const beat of signal.beats) {
      drawDot(
        layout.doc,
        scale.x(beat.timeS),
        scale.y(beat.value),
        0.6,
        beat.flagged ? COLOR.flagged : COLOR.beat,
      );
    }
  }
  layout.y = box.y + box.height + 7;
}

function drawTrend(
  layout: Layout,
  title: string,
  timeS: Float64Array,
  values: Float64Array,
  excluded: boolean[],
  durationS: number,
): void {
  const box: Box = { x: PAGE.margin + 10, y: layout.y + 5, width: CONTENT_WIDTH - 10, height: 26 };
  const [lo, hi] = extent(values);
  drawFrame(layout, box, title, ['0:00', formatTime(durationS)], [lo.toFixed(0), hi.toFixed(0)]);
  const scale = scaleFor(box, [0, durationS], [lo, hi]);
  drawLine(layout.doc, timeS, values, scale, COLOR.signal);
  for (let i = 0; i < values.length; i++) {
    if (excluded[i])
      drawDot(layout.doc, scale.x(timeS[i]), scale.y(values[i]), 0.35, COLOR.flagged);
  }
  layout.y = box.y + box.height + 7;
}

function drawPoincare(layout: Layout, data: Poincare, x: number, y: number, size: number): void {
  const box: Box = { x: x + 10, y: y + 5, width: size, height: size };
  const [loX, hiX] = extent(data.x);
  const [loY, hiY] = extent(data.y);
  const lo = Math.min(loX, loY);
  const hi = Math.max(hiX, hiY);
  drawFrame(
    layout,
    box,
    'Poincaré plot (ms)',
    [lo.toFixed(0), hi.toFixed(0)],
    [lo.toFixed(0), hi.toFixed(0)],
  );
  const scale = scaleFor(box, [lo, hi], [lo, hi]);
  const { doc } = layout;
  doc.setDrawColor(...COLOR.rule);
  doc.line(scale.x(lo), scale.y(lo), scale.x(hi), scale.y(hi));
  const stride = Math.ceil(data.x.length / MAX_PLOT_POINTS);
  for (let i = 0; i < data.x.length; i += stride) {
    drawDot(doc, scale.x(data.x[i]), scale.y(data.y[i]), 0.3, COLOR.signal);
  }
}

function drawFooters(layout: Layout, disclaimer: string): void {
  const { doc } = layout;
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    const y = PAGE.height - PAGE.margin;
    doc.setDrawColor(...COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, y - 4, PAGE.width - PAGE.margin, y - 4);
    layout.font(7.5, 'bold', COLOR.muted);
    doc.text(disclaimer, PAGE.margin, y);
    layout.font(7.5, 'normal', COLOR.muted);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin, y, { align: 'right' });
  }
}

/**
 * Lay out the report as a PDF.
 *
 * The PDF library is loaded only when a report is actually requested, so it
 * does not slow down the first page load for everyone else.
 */
export async function renderReportPdf(model: ReportModel, charts: ReportCharts): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  // Compression matters here: the plots are thousands of small vector shapes.
  const doc = new JsPdf({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({
    title: model.title,
    subject: model.recording[0]?.[1] ?? '',
    creator: 'PulseScope',
  });
  const layout = new Layout(doc);

  layout.font(17, 'bold');
  doc.text(model.title, PAGE.margin, layout.y + 6);
  layout.font(8, 'normal', COLOR.muted);
  doc.text(model.generated, PAGE.margin, layout.y + 11);
  layout.y += 15;

  // The disclaimer sits at the top of the first page as well as in every footer.
  doc.setFillColor(...COLOR.panel);
  doc.rect(PAGE.margin, layout.y, CONTENT_WIDTH, 7, 'F');
  layout.font(8.5, 'bold');
  doc.text(model.disclaimer, PAGE.margin + 2.5, layout.y + 4.6);
  layout.y += 11;

  const columnWidth = (CONTENT_WIDTH - 8) / 2;
  layout.font(9, 'bold');
  doc.text('Recording', PAGE.margin, layout.y + 3);
  doc.text('Settings used', PAGE.margin + columnWidth + 8, layout.y + 3);
  const top = layout.y + 5;
  const leftHeight = drawRows(layout, model.recording, PAGE.margin, top, columnWidth);
  const rightHeight = drawRows(
    layout,
    model.settings,
    PAGE.margin + columnWidth + 8,
    top,
    columnWidth,
  );
  layout.y = top + Math.max(leftHeight, rightHeight) + 4;

  layout.heading('Signal and trends', 52);
  drawSignal(layout, charts);
  if (charts.intervals.bpm.length >= 2) {
    layout.reserve(38);
    drawTrend(
      layout,
      `${charts.rateLabel} over time (bpm)`,
      charts.intervals.timeS,
      charts.intervals.bpm,
      charts.intervals.excluded,
      charts.durationS,
    );
    layout.reserve(38);
    drawTrend(
      layout,
      'Beat-to-beat intervals (ms); excluded intervals marked',
      charts.intervals.timeS,
      charts.intervals.ms,
      charts.intervals.excluded,
      charts.durationS,
    );
  }

  const plotSize = 52;
  layout.heading('Results', plotSize + 12);
  const tableX = PAGE.margin + plotSize + 22;
  const tableWidth = PAGE.width - PAGE.margin - tableX;
  // Start the block on a page with room for the plot, then let the tables flow beside and below it.
  layout.reserve(plotSize + 12);
  const blockTop = layout.y;
  const blockPage = doc.getNumberOfPages();
  if (charts.poincare.x.length >= 2)
    drawPoincare(layout, charts.poincare, PAGE.margin, blockTop, plotSize);
  for (const group of model.metrics)
    drawMetricGroup(layout, group.group, group.rows, group.note, tableX, tableWidth);
  if (doc.getNumberOfPages() === blockPage) layout.y = Math.max(layout.y, blockTop + plotSize + 12);

  layout.heading('Rhythm flags (screening hints, not a diagnosis)');
  if (model.flags.length === 0) {
    layout.font(8.5, 'normal', COLOR.muted);
    layout.y +=
      layout.paragraph(
        'No patterns were flagged by the rules.',
        PAGE.margin,
        layout.y,
        CONTENT_WIDTH,
        8.5,
      ) + 2;
  }
  for (const flag of model.flags) {
    layout.reserve(18);
    layout.font(9, 'bold');
    doc.text(flag.title, PAGE.margin, layout.y + 3.2);
    layout.y += 4.6;
    layout.font(8.5);
    layout.y += layout.paragraph(flag.summary, PAGE.margin, layout.y, CONTENT_WIDTH, 8.5);
    layout.font(7.5, 'normal', COLOR.muted);
    layout.y +=
      layout.paragraph(
        `How it was computed: ${flag.method}`,
        PAGE.margin,
        layout.y,
        CONTENT_WIDTH,
        7.5,
      ) + 3;
  }

  if (model.notes.length > 0) {
    layout.heading('Notes on this recording');
    layout.font(8.5);
    for (const note of model.notes) {
      layout.reserve(8);
      layout.y += layout.paragraph(note, PAGE.margin, layout.y, CONTENT_WIDTH, 8.5) + 1.5;
    }
  }

  drawFooters(layout, model.disclaimer);
  return doc.output('blob');
}
