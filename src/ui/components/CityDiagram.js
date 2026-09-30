const NS = 'http://www.w3.org/2000/svg';

/** Static architectural drawing. No renderer, assets, IDs, or animation loop. */
export function cityDiagram() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 480 190');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'launcher-city-diagram');
  const shapes = [
    ['path', { d: 'M0 165 205 79 480 133 M0 186 210 100 480 154 M74 190 234 124 480 175 M126 117 376 190 M220 79 480 154', class: 'launcher-drawing-streets' }],
    ['path', { d: 'm63 141 0-38 35-14 28 8v39l-35 14z m0-38 28 9 35-15 m-35 15v38 M143 114V61l29-12 33 10v55l-31 12z m0-53 31 10 31-12 m-31 12v55 M214 108V30l30-12 38 12v79l-32 14z m-36-93 36 10 32-10 m-32 10v83 M299 130V71l27-11 35 10v60l-29 13z m-33-72 33 11 29-12 m-29 12v61 M371 152v-40l24-10 30 10v40l-24 10z m-30-50 30 10 24-10 m-24 10v50', class: 'launcher-drawing-buildings' }],
    ['path', { d: 'm151 77 16 5 m-16 4 16 5 m-16 4 16 5 m54-48 22 7 m-22 5 22 7 m-22 5 22 7 m-22 5 22 7 m-22 5 22 7 m68-23 18 6 m-18 5 18 6 m-18 5 18 6 m-18 5 18 6 M70 117l14 4 m-14 5 14 4 m296-2 13 4 m-13 5 13 4', class: 'launcher-drawing-windows' }],
    ['path', { d: 'M24 155 121 115 212 147 274 121 429 166', class: 'launcher-drawing-route' }],
    ['circle', { cx: 274, cy: 121, r: 5, class: 'launcher-drawing-point' }],
    ['circle', { cx: 274, cy: 121, r: 12, class: 'launcher-drawing-ring' }],
    ['path', { d: 'M12 22V10h22 M446 10h22v12 M12 167v12h22 M446 179h22v-12', class: 'launcher-drawing-brackets' }],
  ];
  for (const [tag, attributes] of shapes) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}
