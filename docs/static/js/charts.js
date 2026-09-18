/* Geradores de SVG para o painel gerencial — porta em JS do /tmp/charts.py,
 * seguindo o skill de dataviz: barras finas, extremidades arredondadas 4px,
 * grid recessivo, 1 matiz (azul da marca) já que cada gráfico é de
 * magnitude/única série, rótulos diretos seletivos e tooltip nativo via <title>. */

function escSvg(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** data: [[label, value], ...]. Barras crescem da esquerda (label_w) para a direita. */
function horizontalBarSvg(data, valueSuffix = "", heightPerBar = 34, labelW = 190, chartW = 330, pad = 16) {
  const maxVal = Math.max(...data.map((d) => d[1])) || 1;
  const n = data.length;
  const barH = 18;
  const rowH = heightPerBar;
  const totalH = pad + n * rowH + pad;
  const totalW = labelW + chartW + 50;
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="gráfico de barras horizontais">`);
  const baselineX = labelW;
  for (const frac of [0, 0.25, 0.5, 0.75, 1.0]) {
    const gx = baselineX + chartW * frac;
    parts.push(`<line class="grid-line" x1="${gx.toFixed(1)}" y1="${pad - 6}" x2="${gx.toFixed(1)}" y2="${totalH - pad + 6}" />`);
  }
  data.forEach(([label, val], i) => {
    const y = pad + i * rowH;
    const barW = chartW * (val / maxVal);
    const cy = y + rowH / 2;
    const by = cy - barH / 2;
    parts.push(`<text class="bar-label" x="${labelW - 10}" y="${cy.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escSvg(label)}</text>`);
    parts.push(
      `<rect class="bar-rect" x="${baselineX.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(barW, 3).toFixed(1)}" height="${barH}" rx="4">` +
      `<title>${escSvg(label)}: ${val}${valueSuffix}</title></rect>`
    );
    parts.push(`<text class="bar-value" x="${(baselineX + barW + 8).toFixed(1)}" y="${cy.toFixed(1)}" dominant-baseline="middle">${val}${valueSuffix}</text>`);
  });
  parts.push("</svg>");
  return parts.join("\n");
}

/** data: [[label, value 0-100], ...]. */
function verticalBarSvg(data, valueSuffix = "%", chartH = 200, barW = 56, gap = 34, padTop = 20, padBottom = 46) {
  const maxVal = 100;
  const n = data.length;
  const totalW = padTop + n * (barW + gap);
  const totalH = padTop + chartH + padBottom;
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="gráfico de barras verticais">`);
  const baseY = padTop + chartH;
  for (const frac of [0, 0.25, 0.5, 0.75, 1.0]) {
    const gy = baseY - chartH * frac;
    parts.push(`<line class="grid-line" x1="${padTop - 6}" y1="${gy.toFixed(1)}" x2="${totalW - padTop + 6}" y2="${gy.toFixed(1)}" />`);
  }
  data.forEach(([label, val], i) => {
    const x = padTop + i * (barW + gap);
    const bh = chartH * (val / maxVal);
    const by = baseY - bh;
    const cx = x + barW / 2;
    parts.push(
      `<rect class="bar-rect" x="${x.toFixed(1)}" y="${by.toFixed(1)}" width="${barW}" height="${Math.max(bh, 3).toFixed(1)}" rx="4">` +
      `<title>${escSvg(label)}: ${val}${valueSuffix}</title></rect>`
    );
    parts.push(`<text class="bar-value" x="${cx.toFixed(1)}" y="${(by - 10).toFixed(1)}" text-anchor="middle">${val}${valueSuffix}</text>`);
    const words = label.split(" ");
    let line1 = label;
    let line2 = "";
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(" ");
      line2 = words.slice(mid).join(" ");
    }
    parts.push(`<text class="axis-label" x="${cx.toFixed(1)}" y="${(baseY + 18).toFixed(1)}" text-anchor="middle">${escSvg(line1)}</text>`);
    if (line2) {
      parts.push(`<text class="axis-label" x="${cx.toFixed(1)}" y="${(baseY + 32).toFixed(1)}" text-anchor="middle">${escSvg(line2)}</text>`);
    }
  });
  parts.push("</svg>");
  return parts.join("\n");
}

/** labels: [string,...], values: [number,...]. */
function lineAreaSvg(labels, values, chartH = 200, chartW = 560, pad = 30) {
  const n = values.length;
  const maxVal = Math.max(...values) * 1.25 || 1;
  const totalW = chartW + pad * 2;
  const totalH = chartH + pad * 2;
  const step = n > 1 ? chartW / (n - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + chartH - chartH * (v / maxVal);
    return [x, y];
  });
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="gráfico de linha ao longo do tempo">`);
  for (const frac of [0, 0.25, 0.5, 0.75, 1.0]) {
    const gy = pad + chartH - chartH * frac;
    parts.push(`<line class="grid-line" x1="${pad}" y1="${gy.toFixed(1)}" x2="${pad + chartW}" y2="${gy.toFixed(1)}" />`);
  }
  const areaPts = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `M${pad.toFixed(1)},${(pad + chartH).toFixed(1)} L${areaPts} L${(pad + chartW).toFixed(1)},${(pad + chartH).toFixed(1)} Z`;
  parts.push(`<path class="area-path" d="${areaPath}" />`);
  const linePath = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  parts.push(`<path class="line-path" d="${linePath}" />`);
  pts.forEach(([x, y], i) => {
    const v = values[i];
    const lab = labels[i];
    parts.push(`<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${escSvg(lab)}: ${v}</title></circle>`);
    parts.push(`<text class="bar-value" x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle">${v}</text>`);
    parts.push(`<text class="axis-label" x="${x.toFixed(1)}" y="${(pad + chartH + 18).toFixed(1)}" text-anchor="middle">${escSvg(lab)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("\n");
}
