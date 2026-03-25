/* ── State ───────────────────────────────────────── */
const state = {
  entries: [],
  categories: [],        // name strings for filter/select dropdowns
  categoryColors: {},    // name → color hex
  sortCol: 'date',
  sortDir: 'desc',
  filterCategory: '',
  filterPeriod: '',
  filterDescription: '',
  dirtyHashes: new Set(),
  csvData: null,
  catEditId: null,       // null = add mode, number = edit mode
  summaryData: [],       // cached full monthly summary
};

/* ── DOM refs ────────────────────────────────────── */
const $ = id => document.getElementById(id);

const tbody          = $('entries-tbody');
const footerTotal    = $('footer-total');
const footerCount    = $('footer-count');
const filterCategory = $('filter-category');
const filterPeriod   = $('filter-period');
const filterDesc     = $('filter-description');
const toast          = $('toast');

/* ── Helpers ─────────────────────────────────────── */
function showToast(msg, type = '', duration = 3000) {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast hidden'; }, duration);
}

function formatAmount(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val + 'T00:00:00');
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return val; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Period select ───────────────────────────────── */
async function populatePeriodSelect() {
  const months = await window.api.getEntryMonths();
  const prev   = filterPeriod.value;
  filterPeriod.innerHTML = '<option value="">All</option>';
  months.forEach(m => {
    const [y, mo] = m.split('-');
    const label = new Date(parseInt(y), parseInt(mo) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const o = document.createElement('option');
    o.value = m;
    o.textContent = label;
    filterPeriod.appendChild(o);
  });
  if (prev && [...filterPeriod.options].some(o => o.value === prev)) filterPeriod.value = prev;
}

/* ── Categories (for main grid) ──────────────────── */
async function loadCategories() {
  const full = await window.api.getCategoriesFull();
  state.categories = full.map(c => c.name);
  state.categoryColors = Object.fromEntries(full.map(c => [c.name, c.color || '#6b7280']));
  rebuildCategorySelects();
}

function rebuildCategorySelects() {
  const prevFilter = filterCategory.value;
  filterCategory.innerHTML = '<option value="">All categories</option>';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === prevFilter) o.selected = true;
    filterCategory.appendChild(o);
  });

  document.querySelectorAll('.cat-select').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = buildCatOptions(current);
    const dot = sel.previousElementSibling;
    if (dot && dot.classList.contains('cat-color-dot')) {
      dot.style.background = state.categoryColors[current] || 'transparent';
    }
  });
}

function buildCatOptions(selected) {
  let html = '<option value=""></option>';
  state.categories.forEach(c => {
    html += `<option value="${escHtml(c)}"${c === selected ? ' selected' : ''}>${escHtml(c)}</option>`;
  });
  return html;
}

/* ── Grid ────────────────────────────────────────── */
async function loadEntries() {
  let dateFrom = '', dateTo = '';
  if (state.filterPeriod) {
    const [y, mo] = state.filterPeriod.split('-');
    dateFrom = `${y}-${mo}-01`;
    dateTo   = new Date(parseInt(y), parseInt(mo), 0).toISOString().slice(0, 10);
  }
  state.entries = await window.api.getEntries({
    sortCol:     state.sortCol,
    sortDir:     state.sortDir,
    category:    state.filterCategory,
    dateFrom,
    dateTo,
    description: state.filterDescription,
  });
  renderGrid();
}

function renderGrid() {
  tbody.innerHTML = '';

  if (!state.entries.length) {
    tbody.innerHTML = '<tr id="empty-row"><td colspan="4" class="empty-msg">No entries match the current filters.</td></tr>';
    updateFooter(0, 0);
    return;
  }

  let total = 0;
  const fragment    = document.createDocumentFragment();
  const showSeps    = !state.filterPeriod;
  let   lastMonth   = null;

  state.entries.forEach(entry => {
    if (showSeps) {
      const entryMonth = entry.date ? entry.date.slice(0, 7) : '';
      if (entryMonth !== lastMonth) {
        lastMonth = entryMonth;
        const label = entryMonth
          ? new Date(parseInt(entryMonth.slice(0, 4)), parseInt(entryMonth.slice(5, 7)) - 1, 1)
              .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          : 'Unknown';
        const sep = document.createElement('tr');
        sep.className = 'month-separator';
        sep.innerHTML = `<td colspan="4">${escHtml(label)}</td>`;
        fragment.appendChild(sep);
      }
    }

    const tr = document.createElement('tr');
    const amt = parseFloat(entry.amount) || 0;
    total += amt;
    const amtClass = amt < 0 ? 'amount-negative' : 'amount-positive';
    const dotColor = state.categoryColors[entry.category] || 'transparent';

    tr.innerHTML = `
      <td class="col-date">${escHtml(formatDate(entry.date))}</td>
      <td class="col-description">${escHtml(entry.description)}</td>
      <td class="col-amount ${amtClass}">${escHtml(formatAmount(entry.amount))}</td>
      <td class="col-category">
        <div class="cat-cell">
          <span class="cat-color-dot" style="background:${dotColor}"></span>
          <select class="cat-select" data-hash="${escHtml(entry.hash)}">
            ${buildCatOptions(entry.category)}
          </select>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
  updateFooter(total, state.entries.length);
  updateSortHeaders();
}

function updateFooter(total, count) {
  footerTotal.textContent = formatAmount(total);
  footerTotal.className = total < 0 ? 'amount-negative' : '';
  footerCount.textContent = `(${count} ${count === 1 ? 'entry' : 'entries'})`;
}

function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    th.querySelector('.sort-icon').textContent = '↕';
    if (th.dataset.col === state.sortCol) {
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

/* ── Sort ────────────────────────────────────────── */
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = col === 'date' ? 'desc' : 'asc';
    }
    loadEntries();
  });
});

/* ── Filters ─────────────────────────────────────── */
filterCategory.addEventListener('change', () => {
  state.filterCategory = filterCategory.value;
  loadEntries();
});
filterPeriod.addEventListener('change', () => {
  state.filterPeriod = filterPeriod.value;
  loadEntries();
});
$('btn-clear-filters').addEventListener('click', () => {
  state.filterCategory = state.filterPeriod = state.filterDescription = '';
  filterCategory.value = filterPeriod.value = filterDesc.value = '';
  loadEntries();
});

let descDebounce = null;
filterDesc.addEventListener('input', () => {
  clearTimeout(descDebounce);
  descDebounce = setTimeout(() => {
    state.filterDescription = filterDesc.value.trim();
    loadEntries();
  }, 280);
});

/* ── Category changes in grid ────────────────────── */
tbody.addEventListener('change', e => {
  if (!e.target.classList.contains('cat-select')) return;
  e.target.classList.add('dirty');
  state.dirtyHashes.add(e.target.dataset.hash);
  const dot = e.target.previousElementSibling;
  if (dot && dot.classList.contains('cat-color-dot')) {
    dot.style.background = state.categoryColors[e.target.value] || 'transparent';
  }
});

/* ── Save categories ─────────────────────────────── */
$('btn-save-categories').addEventListener('click', async () => {
  const selects = document.querySelectorAll('.cat-select');
  if (!selects.length) { showToast('Nothing to save.'); return; }

  const result = await window.api.saveCategories(
    Array.from(selects).map(s => ({ hash: s.dataset.hash, category: s.value }))
  );
  if (result.success) {
    selects.forEach(s => s.classList.remove('dirty'));
    state.dirtyHashes.clear();
    showToast('Categories saved.', 'success');
    loadEntries();
  }
});

/* ── Menu actions ────────────────────────────────── */
window.api.onMenuAction(action => {
  if      (action === 'manage-categories') openCatMgmt();
  else if (action === 'monthly-summary')   openMonthlySummary();
  else if (action === 'monthly-graph')     openGraphScreen();
  else if (action === 'import-csv')        triggerImport();
  else if (action === 'show-entries')      showEntriesScreen();
});

function showEntriesScreen() {
  $('summary-screen').classList.add('screen-hidden');
  $('graph-screen').classList.add('screen-hidden');
  $('entries-screen').classList.remove('screen-hidden');
  $('cat-mgmt-overlay').classList.add('hidden');
}

/* ── Categories Management Screen ────────────────── */
$('cat-mgmt-close').addEventListener('click', closeCatMgmt);

async function openCatMgmt() {
  resetCatForm();
  await renderCatList();
  $('cat-mgmt-overlay').classList.remove('hidden');
  $('cat-form-name').focus();
}

async function closeCatMgmt() {
  $('cat-mgmt-overlay').classList.add('hidden');
  await loadCategories();
  renderGrid();
}

async function renderCatList() {
  const cats = await window.api.getCategoriesFull();
  const listBody = $('cat-list-tbody');

  if (!cats.length) {
    listBody.innerHTML = '<tr><td colspan="4" class="cat-empty-msg">No categories yet.</td></tr>';
    return;
  }

  listBody.innerHTML = cats.map(c => `
    <tr>
      <td><span class="cat-swatch" style="background:${escHtml(c.color)}"></span></td>
      <td class="cat-list-name">${escHtml(c.name)}</td>
      <td>${c.is_default ? '<span class="cat-default-badge">Default</span>' : ''}</td>
      <td>
        <div class="cat-list-actions">
          <button class="btn-icon btn-icon-edit" data-action="edit" data-id="${c.id}" title="Edit">&#x270E;</button>
          <button class="btn-icon btn-icon-delete" data-action="delete" data-id="${c.id}" data-name="${escHtml(c.name)}" title="Delete">&#x2715;</button>
        </div>
      </td>
    </tr>
  `).join('');
}

$('cat-list-tbody').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const id = parseInt(btn.dataset.id);

  if (btn.dataset.action === 'edit') {
    const cats = await window.api.getCategoriesFull();
    const cat = cats.find(c => c.id === id);
    if (cat) startEditCat(cat);
  } else if (btn.dataset.action === 'delete') {
    const name = btn.dataset.name;
    if (!confirm(`Delete category "${name}"?\n\nEntries using this category will have their category cleared.`)) return;
    const result = await window.api.deleteCategory(id);
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast(`"${name}" deleted.`, 'success');
      await renderCatList();
    }
  }
});

function startEditCat(cat) {
  state.catEditId = cat.id;
  $('cat-form-name').value = cat.name;
  $('cat-form-color').value = cat.color || '#6b7280';
  $('cat-form-is-default').checked = cat.is_default;
  $('cat-form-title').textContent = `Editing: ${cat.name}`;
  $('cat-form-save').textContent = 'Update';
  $('cat-form-cancel').style.display = '';
  $('cat-form-name').focus();
}

function resetCatForm() {
  state.catEditId = null;
  $('cat-form-name').value = '';
  $('cat-form-color').value = '#6b7280';
  $('cat-form-is-default').checked = false;
  $('cat-form-title').textContent = 'Add Category';
  $('cat-form-save').textContent = 'Add';
  $('cat-form-cancel').style.display = 'none';
}

$('cat-form-cancel').addEventListener('click', resetCatForm);

$('cat-form-save').addEventListener('click', async () => {
  const name = $('cat-form-name').value.trim();
  if (!name) { $('cat-form-name').focus(); return; }

  const result = await window.api.updateCategory({
    id: state.catEditId,
    name,
    color: $('cat-form-color').value,
    is_default: $('cat-form-is-default').checked,
  });

  if (result.error) {
    showToast(result.error, 'error');
  } else {
    showToast(`"${name}" ${state.catEditId ? 'updated' : 'added'}.`, 'success');
    resetCatForm();
    await renderCatList();
  }
});

$('cat-form-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('cat-form-save').click();
  if (e.key === 'Escape') resetCatForm();
});

/* ── Monthly Summary Screen ──────────────────────── */
async function openMonthlySummary() {
  $('entries-screen').classList.add('screen-hidden');
  $('graph-screen').classList.add('screen-hidden');
  $('summary-screen').classList.remove('screen-hidden');
  $('summary-body').innerHTML = '<div class="summary-loading">Loading\u2026</div>';

  state.summaryData = await window.api.getMonthlySummary();
  populateSummarySelect();
  renderMonthlySummary(state.summaryData);
}

function closeMonthlySummary() {
  $('summary-screen').classList.add('screen-hidden');
  $('entries-screen').classList.remove('screen-hidden');
}

function populateSummarySelect() {
  const sel  = $('summary-month-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Months</option>';
  state.summaryData.forEach(m => {
    const label = new Date(parseInt(m.year), parseInt(m.month) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const o = document.createElement('option');
    o.value = `${m.year}-${m.month}`;
    o.textContent = label;
    sel.appendChild(o);
  });
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

$('summary-month-select').addEventListener('change', () => {
  const val  = $('summary-month-select').value;
  const data = val
    ? state.summaryData.filter(m => `${m.year}-${m.month}` === val)
    : state.summaryData;
  renderMonthlySummary(data);
});

function renderMonthlySummary(months) {
  const body = $('summary-body');

  if (!months.length) {
    body.innerHTML = '<div class="summary-empty">No entries to summarise.</div>';
    return;
  }

  body.innerHTML = months.map(m => {
    const label = new Date(parseInt(m.year), parseInt(m.month) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const cats = m.categories.map(c => `
      <div class="summary-cat-row"
           data-year="${m.year}" data-month="${m.month}"
           data-category="${escHtml(c.name)}">
        <span class="cat-color-dot" style="background:${escHtml(c.color)}"></span>
        <span class="summary-cat-name">${escHtml(c.name || '(uncategorized)')}</span>
        <span class="summary-cat-total ${c.total < 0 ? 'amount-negative' : 'amount-positive'}">${formatAmount(c.total)}</span>
      </div>`).join('');

    return `
      <div class="summary-month">
        <div class="summary-month-header"
             data-year="${m.year}" data-month="${m.month}">
          <span class="summary-month-label">${escHtml(label)}</span>
          <span class="summary-month-total ${m.total < 0 ? 'amount-negative' : 'amount-positive'}">${formatAmount(m.total)}</span>
        </div>
        <div class="summary-cats">${cats}</div>
      </div>`;
  }).join('');
}

$('summary-body').addEventListener('click', e => {
  const cat    = e.target.closest('.summary-cat-row');
  const header = e.target.closest('.summary-month-header');
  const target = cat || header;
  if (!target) return;

  navigateToEntries({
    year:     target.dataset.year,
    month:    target.dataset.month,
    category: cat ? cat.dataset.category : '',
  });
});

function navigateToEntries({ year = '', month = '', category = '' } = {}) {
  $('summary-screen').classList.add('screen-hidden');
  $('graph-screen').classList.add('screen-hidden');
  $('entries-screen').classList.remove('screen-hidden');

  const period = year && month ? `${year}-${month.toString().padStart(2, '0')}` : '';

  state.filterPeriod      = period;
  state.filterCategory    = category;
  state.filterDescription = '';

  filterPeriod.value   = period;
  filterCategory.value = category;
  filterDesc.value     = '';

  loadEntries();
}

/* ── Monthly Graph Screen ────────────────────────── */
let chartInstance = null;

async function openGraphScreen() {
  $('entries-screen').classList.add('screen-hidden');
  $('summary-screen').classList.add('screen-hidden');
  $('graph-screen').classList.remove('screen-hidden');
  state.summaryData = await window.api.getMonthlySummary();
  renderGraph();
}

$('chart-type-select').addEventListener('change', renderGraph);

function renderGraph() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const isBar = $('chart-type-select').value === 'bar';

  // Oldest → newest for natural timeline direction
  const months = [...state.summaryData].reverse();

  if (!months.length) {
    $('graph-canvas-wrap').innerHTML = '<div class="graph-empty">No entries to display.</div>';
    return;
  }

  // X axis labels: "Jan 24", "Feb 24", …
  const labels = months.map(m =>
    new Date(parseInt(m.year), parseInt(m.month) - 1, 1)
      .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  );

  // Collect unique categories in order of first appearance, with their color
  const catColorMap = new Map();
  months.forEach(m => m.categories.forEach(c => {
    if (!catColorMap.has(c.name)) catColorMap.set(c.name, c.color);
  }));
  const catNames  = [...catColorMap.keys()];
  const catColors = [...catColorMap.values()];

  // For stacked bar: sort categories by total sum descending so the largest
  // segment is always at the bottom of the stack.
  let orderedNames  = catNames;
  let orderedColors = catColors;
  if (isBar) {
    const totals = catNames.map(name =>
      months.reduce((sum, m) => { const c = m.categories.find(c => c.name === name); return sum + (c ? parseFloat(c.total) : 0); }, 0)
    );
    const indices = totals.map((_, i) => i).sort((a, b) => totals[a] - totals[b]);
    orderedNames  = indices.map(i => catNames[i]);
    orderedColors = indices.map(i => catColors[i]);
  }

  const datasets = orderedNames.map((name, i) => {
    const color = orderedColors[i];
    // Bar mode uses 0 for missing months so stacking isn't broken by null gaps
    const data  = months.map(m => { const c = m.categories.find(c => c.name === name); return c ? parseFloat(c.total) : (isBar ? 0 : null); });
    if (isBar) {
      return {
        label:           name || '(uncategorized)',
        data,
        backgroundColor: color + 'cc',
        borderColor:     color,
        borderWidth:     1,
      };
    }
    return {
      label:              name || '(uncategorized)',
      data,
      borderColor:        color,
      backgroundColor:    color + '22',
      pointBackgroundColor: color,
      pointBorderColor:   '#fff',
      pointBorderWidth:   2,
      borderWidth:        2,
      tension:            0,
      spanGaps:           true,
      pointRadius:        5,
      pointHoverRadius:   9,
      pointHitRadius:     12,
    };
  });

  const canvas = $('monthly-chart');

  // Tracks which legend dataset is currently hovered (for the label plugin)
  let hoveredLegendIdx = null;

  // Inline plugin: draws amount labels on hovered dataset
  // – Line chart: floating pill above each point
  // – Bar chart: label centered inside bar segment if tall enough
  const pointLabelPlugin = {
    id: 'pointLabels',
    afterDraw(chart) {
      if (hoveredLegendIdx == null) return;
      const di   = hoveredLegendIdx;
      const ds   = chart.data.datasets[di];
      const meta = chart.getDatasetMeta(di);
      const ctx  = chart.ctx;

      ctx.save();
      ctx.font         = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      meta.data.forEach((element, i) => {
        const value = ds.data[i];
        if (value == null) return;

        const text = formatAmount(value);

        if (isBar) {
          // Draw label inside the bar segment if it is tall enough
          const barTop    = element.y;
          const barBottom = element.base ?? chart.chartArea.bottom;
          const barHeight = barBottom - barTop;
          if (barHeight < 20) return;

          ctx.fillStyle = '#fff';
          const midY = barTop + barHeight / 2;
          ctx.fillText(text, element.x, midY);
        } else {
          // Floating pill above the point
          const tw  = ctx.measureText(text).width;
          const pad = 5;
          const bw  = tw + pad * 2;
          const bh  = 20;
          const bx  = element.x - bw / 2;
          const by  = Math.max(chart.chartArea.top + 2, element.y - bh - 8);

          ctx.fillStyle = 'rgba(15,23,42,.88)';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 4);
          ctx.fill();

          ctx.fillStyle = '#f8fafc';
          ctx.fillText(text, element.x, by + bh / 2);
        }
      });

      ctx.restore();
    },
  };

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: isBar ? 'bar' : 'line',
    plugins: [pointLabelPlugin],
    data: { labels, datasets },
    options: {
      responsive:           true,
      maintainAspectRatio:  false,
      interaction:          { mode: 'point', intersect: true },

      onHover(event, elements, chart) {
        if (event.x == null || event.y == null) return;
        const inXAxis = event.y > chart.chartArea.bottom && event.y <= chart.height;
        canvas.style.cursor = (elements.length || inXAxis) ? 'pointer' : 'default';
      },

      onClick(event, elements, chart) {
        if (event.x == null || event.y == null) return;
        const { x, y } = event;

        if (elements.length) {
          const { datasetIndex, index } = elements[0];
          const m        = months[index];
          const names    = isBar ? orderedNames : catNames;
          navigateToEntries({ year: m.year, month: m.month, category: names[datasetIndex] });
          return;
        }

        // Click in the X axis label area → month only
        if (y > chart.chartArea.bottom && y <= chart.height
            && x >= chart.chartArea.left && x <= chart.chartArea.right) {
          const xScale = chart.scales.x;
          let nearIdx = -1, nearDist = Infinity;
          xScale.ticks.forEach((tick, i) => {
            const d = Math.abs(x - xScale.getPixelForTick(i));
            const idx = tick.value ?? i;
            if (d < nearDist) { nearDist = d; nearIdx = idx; }
          });
          if (nearIdx >= 0 && nearDist < 80 && months[nearIdx]) {
            const m = months[nearIdx];
            navigateToEntries({ year: m.year, month: m.month });
          }
        }
      },

      scales: {
        x: {
          stacked: isBar,
          grid:    { color: 'rgba(0,0,0,.06)' },
          ticks:   { font: { size: 11 }, color: '#64748b', maxRotation: 45, minRotation: 0 },
        },
        y: {
          stacked: isBar,
          grid:    { color: 'rgba(0,0,0,.06)' },
          ticks:   { font: { size: 11 }, color: '#64748b', callback: v => formatAmount(v) },
        },
      },

      plugins: {
        legend: {
          position: 'bottom',
          labels:   { font: { size: 12 }, boxWidth: 14, padding: 20, color: '#374151' },
          onClick(evt, item) {
            navigateToEntries({ category: item.text === '(uncategorized)' ? '' : item.text });
          },
          onHover(evt, item, legend) {
            hoveredLegendIdx = item.datasetIndex;
            const chart  = legend.chart;
            const colors = isBar ? orderedColors : catColors;
            chart.data.datasets.forEach((ds, i) => {
              if (isBar) {
                ds.backgroundColor = i === item.datasetIndex ? colors[i] + 'cc' : colors[i] + '33';
                ds.borderColor     = i === item.datasetIndex ? colors[i]         : colors[i] + '33';
              } else {
                ds.borderColor          = i === item.datasetIndex ? colors[i] : colors[i] + '33';
                ds.pointBackgroundColor = i === item.datasetIndex ? colors[i] : colors[i] + '33';
                ds.borderWidth          = i === item.datasetIndex ? 3 : 1;
              }
            });
            chart.update('none');
          },
          onLeave(evt, item, legend) {
            hoveredLegendIdx = null;
            const chart  = legend.chart;
            const colors = isBar ? orderedColors : catColors;
            chart.data.datasets.forEach((ds, i) => {
              if (isBar) {
                ds.backgroundColor = colors[i] + 'cc';
                ds.borderColor     = colors[i];
              } else {
                ds.borderColor          = colors[i];
                ds.pointBackgroundColor = colors[i];
                ds.borderWidth          = 2;
              }
            });
            chart.update('none');
          },
        },
        tooltip: {
          mode:      'index',
          intersect: false,
          filter:    item => item.raw != null && item.raw !== 0,
          itemSort:  (a, b) => (b.raw ?? -Infinity) - (a.raw ?? -Infinity),
          callbacks: {
            label:  ctx  => `${ctx.dataset.label}: ${formatAmount(ctx.raw)}`,
            footer: items => {
              const total = items.reduce((sum, item) => sum + parseFloat(item.raw ?? 0), 0);
              return `Total: ${formatAmount(total)}`;
            },
          },
        },
      },
    },
  });
}

/* ── CSV Import ──────────────────────────────────── */
async function triggerImport() {
  const result = await window.api.importCsv();
  if (!result.canceled) parseCsvContent(result.content);
}

function parseCsvContent(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    showToast('CSV file appears to be empty or has no data rows.', 'error');
    return;
  }
  const rows = lines.map(parseCsvLine);
  state.csvData = { headers: rows[0], dataRows: rows.slice(1) };
  openImportModal(state.csvData.headers, state.csvData.dataRows);
}

function parseCsvLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function openImportModal(headers, dataRows) {
  ['map-date', 'map-description', 'map-amount'].forEach(id => {
    const sel = $(id);
    sel.innerHTML = '';
    headers.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = h || `Column ${i + 1}`;
      sel.appendChild(o);
    });
  });

  autoDetect(headers, 'map-date',        ['date', 'transaction date', 'trans date', 'posted date', 'posting date']);
  autoDetect(headers, 'map-description', ['description', 'desc', 'merchant', 'name', 'details', 'memo', 'narrative']);
  autoDetect(headers, 'map-amount',      ['amount', 'debit', 'credit', 'charge', 'value', 'transaction amount']);

  renderPreview(headers, dataRows.slice(0, 5));
  $('import-modal-overlay').classList.remove('hidden');

  ['map-date', 'map-description', 'map-amount'].forEach(id => {
    $(id).addEventListener('change', () => renderPreview(headers, dataRows.slice(0, 5)));
  });
}

function autoDetect(headers, selectId, candidates) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex(h => h === c || h.includes(c));
    if (idx >= 0) { $(selectId).value = idx; return; }
  }
}

function renderPreview(headers, rows) {
  const dateIdx = parseInt($('map-date').value);
  const descIdx = parseInt($('map-description').value);
  const amtIdx  = parseInt($('map-amount').value);

  $('preview-thead').innerHTML = headers.map((h, i) => {
    let label = h || `Col ${i + 1}`;
    if (i === dateIdx) label += ' (date)';
    if (i === descIdx) label += ' (desc)';
    if (i === amtIdx)  label += ' (amount)';
    return `<th>${escHtml(label)}</th>`;
  }).join('');

  $('preview-tbody').innerHTML = rows.map(row =>
    `<tr>${headers.map((_, i) => `<td>${escHtml(row[i] ?? '')}</td>`).join('')}</tr>`
  ).join('');
}

$('import-cancel').addEventListener('click', () => {
  $('import-modal-overlay').classList.add('hidden');
  state.csvData = null;
});

$('import-confirm').addEventListener('click', async () => {
  const { headers, dataRows } = state.csvData;
  const dateIdx = parseInt($('map-date').value);
  const descIdx = parseInt($('map-description').value);
  const amtIdx  = parseInt($('map-amount').value);

  const rows = dataRows
    .filter(row => row.some(cell => cell !== ''))
    .map(row => ({
      date:        normalizeDate(row[dateIdx] ?? ''),
      description: (row[descIdx] ?? '').trim(),
      amount:      parseAmount(row[amtIdx] ?? ''),
    }))
    .filter(r => r.date && r.description);

  if (!rows.length) {
    showToast('No valid rows found. Check your column mapping.', 'error');
    return;
  }

  const result = await window.api.saveEntries(rows);
  $('import-modal-overlay').classList.add('hidden');
  state.csvData = null;
  showToast(`Import complete: ${result.imported} new, ${result.skipped} duplicate(s) skipped.`, 'success', 5000);
  await populatePeriodSelect();
  await loadEntries();
});

function normalizeDate(val) {
  if (!val) return '';
  const s = val.trim();
  const patterns = [
    { re: /^(\d{4})-(\d{2})-(\d{2})$/,      fn: m => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, fn: m => `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` },
    { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,   fn: m => `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` },
    { re: /^(\d{2})\/(\d{2})\/(\d{4})$/,      fn: m => `${m[3]}-${m[2]}-${m[1]}` },
  ];
  for (const { re, fn } of patterns) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

function parseAmount(val) {
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* ── Init ────────────────────────────────────────── */
(async () => {
  await Promise.all([loadCategories(), populatePeriodSelect()]);
  await loadEntries();
})();
