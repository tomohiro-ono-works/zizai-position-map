const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.value = '';
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.style = {};
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.dataset = {};
    this.classList = {toggle: () => {}};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  dispatch(name, details = {}) { this.handlers[name]?.({target: this, ...details}); }
  querySelector(name) { return name === '.table-wrap' ? this.scrollArea : null; }
  getBoundingClientRect() { return this.rect ?? {top: 100, bottom: 120, left: 100, right: 120, width: 20, height: 20}; }
  showPopover() { this.popoverOpen = true; }
  hidePopover() { this.popoverOpen = false; }
  querySelectorAll(selector) {
    if (selector !== 'textarea[data-autosize-detail="true"]') return [];
    const found = [];
    const walk = node => {
      if (node.tagName === 'textarea' && node.attributes['data-autosize-detail'] === 'true') found.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(this);
    return found;
  }
  get scrollHeight() { return this.tagName === 'textarea' ? 18 + Math.ceil(String(this.value).length / 20) * 18 : 0; }
}

function setup(useInitialSample = false) {
  const elements = new Map();
  const navigation = {};
  const formatting = {};
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  getElement('table-input').scrollArea = new Element();
  for (const view of ['definition', 'input', 'analysis']) {
    navigation[view] = new Element('button');
    navigation[view].dataset.viewTab = view;
  }
  for (const format of ['table', 'yaml']) {
    formatting[format] = new Element('button');
    formatting[format].dataset.formatTab = format;
  }
  const columns = [
    {id: 'name', name: '案件名', type: 'text', cardinality: '1:1', options: []},
    {id: 'stage', name: '業務の上位工程', type: 'select', cardinality: '1:1', options: ['設計', '評価'], allowDetail: true, optionColors: {'設計': '#112233'}},
    {id: 'tech', name: '技術の高度化', type: 'multiselect', cardinality: '1:N', options: ['統計', '機械学習'], allowDetail: true, optionColors: {'統計': '#e3a4c5'}}
  ];
  const projects = [
    {id: 'p1', data: {name: '案件A', stage: '設計', tech: ['統計']}},
    {id: 'p2', data: {name: '案件B', stage: '評価', tech: ['機械学習']}}
  ];
  const storage = useInitialSample ? new Map() : new Map([['dx_three_screens_v2', JSON.stringify({detailUiVersion: 1, columns, projects})]]);
  const document = {
    createElement: tag => new Element(tag),
    createTextNode: text => ({textContent: text}),
    getElementById: getElement,
    querySelector: selector => {
      const match = selector.match(/^\[data-view-tab="(.+)"\]$/);
      const formatMatch = selector.match(/^\[data-format-tab="(.+)"\]$/);
      return match ? navigation[match[1]] : formatMatch ? formatting[formatMatch[1]] : new Element();
    },
    querySelectorAll: selector => selector === '[data-view-tab]' ? Object.values(navigation) : selector === '[data-format-tab]' ? Object.values(formatting) : []
  };
  const context = {
    document,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    structuredClone, Date, Math, JSON, Set, Map, console, window: {innerHeight: 680, innerWidth: 1200},
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true
  };
  vm.runInNewContext(scripts.join('\n'), context);
  navigation.input.dispatch('click');
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  };
  return {body: getElement('entry-body'), find, storage, navigation, formatting, getElement, context};
}

test('formatting prompt copy is visible only in YAML mode on definition and input views', () => {
  const {formatting, navigation, getElement} = setup();
  const definitionButton = getElement('copy-definition-prompt');
  const definitionBar = getElement('definition-prompt-action-bar');
  const inputButton = getElement('copy-input-prompt');
  const inputBar = getElement('input-prompt-action-bar');
  assert.doesNotMatch(html, /id="load-five-axis-sample"/, 'sample-switch button is removed from the definition view');
  assert.doesNotMatch(html, /function loadFiveAxisSample\(/, 'unused sample-switch logic is removed');
  assert.equal(definitionButton.hidden, true, 'definition prompt is hidden in table mode');
  assert.equal(definitionBar.hidden, true, 'definition prompt bar leaves no empty space in table mode');
  assert.equal(inputButton.hidden, true, 'input prompt is hidden in table mode');
  assert.equal(inputBar.hidden, true, 'input prompt bar does not leave empty vertical space');
  formatting.yaml.dispatch('click');
  assert.equal(definitionButton.hidden, false);
  assert.equal(definitionBar.hidden, false);
  assert.equal(inputButton.hidden, false);
  assert.equal(inputBar.hidden, false);
  navigation.input.dispatch('click');
  assert.equal(inputButton.hidden, false, 'stays visible in input YAML view');
  formatting.table.dispatch('click');
  assert.equal(definitionButton.hidden, true);
  assert.equal(definitionBar.hidden, true);
  assert.equal(inputButton.hidden, true);
  assert.equal(inputBar.hidden, true);
});

test('definition option editor toggles with a plain small chevron and no surrounding frame', () => {
  const {navigation, getElement, find} = setup();
  navigation.definition.dispatch('click');
  const editor = getElement('field-editor');
  const row = editor.children[1];
  const details = find(row, node => node.tagName === 'details' && node.className === 'definition-accordion');
  const chevron = find(details, node => node.className === 'definition-chevron');
  assert.ok(chevron, 'a separate, simple chevron is visible next to candidate summary');
  assert.equal(chevron.textContent, '＞');
  details.open = true;
  details.dispatch('toggle');
  assert.equal(chevron.textContent, '⋁');
  const accordion = html.match(/\n\.definition-accordion\{([^}]+)\}/)?.[1] || '';
  assert.match(accordion, /background:transparent/);
  const summary = html.match(/\.definition-accordion>summary\{([^}]+)\}/)?.[1] || '';
  assert.match(summary, /border:0/);
  const arrowRule = html.match(/\.definition-chevron\{([^}]+)\}/)?.[1] || '';
  assert.match(arrowRule, /font-size:12px/);
});

test('definition selects are borderless light gray while field names highlight on hover', () => {
  const dropdown = html.match(/#field-editor \.field-card>select\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(dropdown, /border:0/);
  assert.match(dropdown, /background:#f7f8fa/);
  const dropdownHover = html.match(/#field-editor \.field-card>select\.control:hover\{([^}]+)\}/)?.[1] || '';
  assert.match(dropdownHover, /background:#f1f3f5/);
  const input = html.match(/#field-editor \.field-card>input\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(input, /border:1px solid transparent/);
  assert.match(input, /background:transparent/);
  const hover = html.match(/#field-editor \.field-card>input\.control:hover\{([^}]+)\}/)?.[1] || '';
  assert.match(hover, /border-color:#c8d5e4/);
  assert.match(hover, /background:#f7f8fa/);
});

test('definition candidate summary shows a flat, wrapping label for every option with saved colors', () => {
  const {navigation, getElement, find} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const accordion = find(row, node => node.tagName === 'details' && node.className === 'definition-accordion');
  const labels = find(accordion, node => node.className === 'definition-option-chips');
  assert.ok(labels, 'summary shows chips, not a joined candidate string');
  assert.deepEqual(labels.children.map(item => item.textContent), ['設計', '評価']);
  assert.equal(labels.children[0].style.backgroundColor, '#112233', 'defined option color is reflected');
  assert.equal(labels.children[1].style.backgroundColor, undefined, 'uncolored options retain the neutral style');
  const layout = html.match(/\.definition-option-chips\{([^}]+)\}/)?.[1] || '';
  assert.match(layout, /display:flex/);
  assert.match(layout, /flex-wrap:wrap/);
  const chipStyle = html.match(/\.definition-option-chip\{([^}]+)\}/)?.[1] || '';
  assert.match(chipStyle, /border-radius:3px/);
  assert.match(chipStyle, /box-shadow:none/);
  assert.ok(find(accordion, node => node.tagName === 'textarea' && node.className === 'option-area'), 'original option editor is preserved');
});

test('updating a defined label color also updates its candidate preview chip', () => {
  const {navigation, getElement, find, storage} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const colorInput = find(row, node => node.tagName === 'input' && node.type === 'color' && node.getAttribute('aria-label') === '業務の上位工程 設計のラベル色');
  assert.ok(colorInput);
  colorInput.value = '#abcdef';
  colorInput.dispatch('change');
  const updatedRow = getElement('field-editor').children[1];
  const labels = find(updatedRow, node => node.className === 'definition-option-chips');
  assert.equal(labels.children[0].style.backgroundColor, '#abcdef');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[1].optionColors['設計'], '#abcdef');
});

test('projects are initially collapsed and expand independently without changing their data', () => {
  const {body, find, storage} = setup();
  assert.equal(body.children.length, 2);
  for (const row of body.children) {
    assert.match(row.className, /project-collapsed/);
    assert.equal(find(row, node => node.className === 'detail-message-wrap')?.hidden, false);
    assert.equal(find(row, node => node.className === 'detail-message-preview')?.hidden, false);
  }
  const openFirst = find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞');
  assert.ok(openFirst, 'project title includes an expand button');
  assert.equal(openFirst.getAttribute('aria-expanded'), 'false');
  openFirst.dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.equal(find(body.children[0], node => node.className === 'detail-message-wrap')?.hidden, false);
  assert.match(body.children[1].className, /project-collapsed/);
  find(body.children[1], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.match(body.children[1].className, /project-expanded/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '⋁').dispatch('click');
  assert.match(body.children[0].className, /project-collapsed/);
  assert.match(body.children[1].className, /project-expanded/);
  const state = JSON.parse(storage.get('dx_three_screens_v2'));
  assert.equal(state.projects[0].tree.children[0].value, '設計');
});

test('existing 1:N controls remain available when project details are collapsed', () => {
  const {body, find} = setup();
  const add = find(body.children[0].children[2], node => node.tagName === 'button' && node.textContent === '＋');
  assert.ok(add, '1:N add control remains visible');
  add.dispatch('click');
  assert.equal(body.children.length, 3);
  assert.match(body.children[0].className, /project-collapsed/);
  assert.match(body.children[1].className, /project-collapsed/);
  assert.equal(body.children[0].children[0].rowSpan, 2);
});

test('single selection uses the same filter menu with exclusive radio options', () => {
  const {body, find, storage} = setup();
  const stageCell = body.children[0].children[1];
  const label = find(stageCell, node => node.className === 'choice-chip');
  assert.equal(label?.textContent, '設計');
  const picker = find(stageCell, node => node.tagName === 'details' && node.className === 'multi-picker');
  assert.ok(picker, 'single choice uses the same filter dropdown component');
  const glyph = find(picker, node => node.className === 'filter-alt-icon');
  assert.ok(glyph);
  const inputs = [];
  const collect = node => {
    if (node.tagName === 'input') inputs.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(picker);
  assert.deepEqual(inputs.map(input => input.type), ['radio', 'radio', 'radio']);
  assert.equal(inputs[1].checked, true);
  assert.equal(new Set(inputs.map(input => input.name)).size, 1);
  picker.open = true;
  picker.dispatch('toggle');
  assert.equal(find(picker, node => node.className?.includes?.('choice-popover')).popoverOpen, true);
  inputs[2].checked = true;
  inputs[2].dispatch('change');
  const changed = find(body.children[0].children[1], node => node.className === 'choice-chip');
  assert.equal(changed?.textContent, '評価');
  assert.equal(picker.open, false, 'single picker closes after one choice');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.children[0].value, '評価');
});

test('multiple selections show one label per value and keep the 1:N controls', () => {
  const {body, find} = setup();
  const labels = node => {
    const results = [];
    const walk = item => {
      if (item?.className === 'choice-chip') results.push(item.textContent);
      for (const child of item?.children ?? []) walk(child);
    };
    walk(node);
    return results;
  };
  const techCell = body.children[0].children[2];
  assert.deepEqual(labels(techCell), ['統計']);
  const edit = find(techCell, node => node.tagName === 'summary');
  assert.equal(edit?.textContent, '');
  assert.ok(find(edit, node => node.className === 'filter-alt-icon'));
  const second = find(techCell, node => node.tagName === 'input' && node.attributes['aria-label'] === '技術の高度化 機械学習');
  second.checked = true;
  second.dispatch('change');
  assert.deepEqual(labels(techCell), ['統計', '機械学習']);
  assert.ok(find(techCell, node => node.tagName === 'button' && node.textContent === '＋'));
});

test('definition YAML preserves per-option label colors and validates mappings', () => {
  const {context} = setup();
  const schema = {columns: [
    {name: '案件名', type: 'text', cardinality: '1:1'},
    {name: '技術', type: 'multiselect', cardinality: '1:N', options: ['統計', '機械学習'], allowDetail: true,
      optionColors: {'統計': '#aabbcc', '機械学習': '#112233'}}
  ]};
  const yaml = context.serializeSchema(schema);
  assert.match(yaml, /optionColors:/);
  assert.match(yaml, /"統計": "#aabbcc"/);
  const parsed = context.parseSchema(yaml);
  assert.equal(context.validateSchema(parsed), true);
  assert.equal(parsed.columns[1].optionColors['機械学習'], '#112233');
  parsed.columns[1].optionColors['機械学習'] = '#hijklm';
  assert.throws(() => context.validateSchema(parsed), /色|#[Rr][Gg][Bb]/);
  delete parsed.columns[1].optionColors['機械学習'];
  parsed.columns[1].optionColors['未定義候補'] = '#ffffff';
  assert.throws(() => context.validateSchema(parsed), /未定義|候補/);
});

test('workspace YAML saves label colors and reports incompatible merged definitions', () => {
  const {context, storage} = setup();
  const source = JSON.parse(storage.get('dx_three_screens_v2'));
  const yaml = context.serializeWorkspaceYaml(source);
  const parsed = context.parseWorkspaceYaml(yaml);
  assert.equal(parsed.columns[1].optionColors['設計'], '#112233');
  assert.equal(parsed.columns[2].optionColors['統計'], '#e3a4c5');
  const incompatible = structuredClone(parsed);
  incompatible.columns[2].optionColors['統計'] = '#112233';
  assert.throws(() => context.mergeWorkspaceYamlSnapshots([parsed, incompatible]), /定義が一致しません/);
});

test('per-option color from definition applies to all matching labels and can be edited or cleared', () => {
  const {body, find, storage, navigation, getElement} = setup();
  const firstStage = find(body.children[0].children[1], node => node.className === 'choice-chip');
  assert.equal(firstStage?.style.backgroundColor, '#112233');
  const firstTech = find(body.children[0].children[2], node => node.className === 'choice-chip');
  assert.equal(firstTech?.style.backgroundColor, '#e3a4c5');
  navigation.definition.dispatch('click');
  const editor = getElement('field-editor');
  const picker = find(editor, node => node.tagName === 'input' && node.type === 'color' && node.attributes['aria-label'] === '技術の高度化 統計のラベル色');
  assert.ok(picker);
  picker.value = '#abc123';
  picker.dispatch('change');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[2].optionColors['統計'], '#abc123');
  navigation.input.dispatch('click');
  assert.equal(find(body.children[0].children[2], node => node.className === 'choice-chip')?.style.backgroundColor, '#abc123');
  navigation.definition.dispatch('click');
  const reset = find(getElement('field-editor'), node => node.tagName === 'button' && node.attributes['aria-label'] === '技術の高度化 統計のラベル色を解除');
  assert.ok(reset);
  reset.dispatch('click');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[2].optionColors['統計'], undefined);
});

test('initial demo renders visible preset colors for the four technology directions', () => {
  const {body, find, storage} = setup(true);
  const demo = JSON.parse(storage.get('dx_three_screens_v2'));
  const tech = demo.columns.find(column => column.name === '技術の高度化');
  for (const option of ['エンジニアリング', '統計', '機械学習', '推論・生成AI']) {
    assert.match(tech.optionColors[option], /^#[0-9a-f]{6}$/);
  }
  const engineering = find(body.children[0].children[3], node => node.className === 'choice-chip');
  assert.equal(engineering.style.backgroundColor, tech.optionColors['エンジニアリング']);
});

test('choice labels are compact and flat without gradients or shadows', () => {
  const rule = html.match(/\.entry-table \.choice-chip\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'labels have a dedicated style rule');
  assert.match(rule, /border-radius:3px/);
  assert.match(rule, /padding:1px 5px/);
  assert.match(rule, /line-height:1\.35/);
  assert.match(rule, /box-shadow:none/);
  assert.match(rule, /background-image:none/);
  const listRule = html.match(/\.entry-table \.choice-chip-list\{([^}]+)\}/)?.[1];
  assert.match(listRule, /gap:3px/);
  const {body, find} = setup();
  assert.equal(find(body.children[0].children[1], node => node.className === 'choice-chip')?.textContent, '設計');
});

test('input table headers use dark blue-gray with white text while preserving light data cells', () => {
  const headerRule = html.match(/\.entry-table th\{([^}]+)\}/)?.[1];
  assert.ok(headerRule, 'input table has a dedicated header style');
  assert.match(headerRule, /background:#344f67/);
  assert.match(headerRule, /color:#fff/);
  assert.match(headerRule, /border-bottom:1px solid #223e55/);
  const {body, find} = setup();
  assert.equal(body.children.length, 2);
  assert.ok(find(body.children[0], node => node.className === 'choice-chip'));
});

test('collapsed row previews one line; expanded row displays and edits the complete message', () => {
  const {body, find, storage} = setup(true);
  const firstRow = body.children[0];
  const detailWrap = find(firstRow.children[1], node => node.className === 'detail-message-wrap');
  const collapsedPreview = find(firstRow.children[1], node => node.className === 'detail-message-preview');
  const collapsedEditor = find(firstRow.children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  assert.equal(detailWrap.hidden, false);
  assert.equal(collapsedPreview.hidden, false);
  assert.equal(collapsedEditor.hidden, true);
  find(firstRow, node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  const detail = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  const preview = find(body.children[0].children[1], node => node.className === 'detail-message-preview');
  assert.ok(detail, 'details stay under their existing column');
  assert.ok(preview, 'preview is available for the collapsed state');
  assert.equal(detail.hidden, false, 'the full editor is visible in the expanded row');
  assert.ok(preview.textContent.length > 0);
  assert.equal(preview.hidden, true);
  assert.equal(detail.getAttribute('data-autosize-detail'), 'true');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  const contents = '要件と設計の記録を詳細に残します。'.repeat(24);
  detail.value = contents;
  detail.dispatch('input');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.children[0].detail, contents);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '⋁').dispatch('click');
  const afterClose = find(body.children[0].children[1], node => node.className === 'detail-message-preview');
  const afterCloseEditor = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  assert.equal(afterClose.hidden, false);
  assert.equal(afterCloseEditor.hidden, true);
  assert.match(afterClose.textContent, /要件と設計/);
  assert.ok(afterClose.textContent.length > 10, 'preview retains text without truncating the saved data');
  Object.defineProperty(detail, 'scrollHeight', {configurable: true, value: undefined});
  detail.dispatch('input');
  assert.equal(detail.style.height, '65px', 'unknown size falls back to a usable minimum');
  const rules = [...html.matchAll(/\.entry-table \.entry-editor-choice \.detail-message-wrap textarea\.control\{([^}]+)\}/g)];
  const finalRule = rules.at(-1)?.[1] || '';
  assert.match(finalRule, /overflow:hidden/);
  assert.match(finalRule, /flex:none/);
  assert.match(finalRule, /resize:none/);
  const previewRule = html.match(/\.entry-table \.detail-message-preview\{([^}]+)\}/)?.[1] || '';
  assert.match(previewRule, /white-space:nowrap/);
  assert.match(previewRule, /text-overflow:ellipsis/);
  assert.match(previewRule, /overflow:hidden/);
  assert.match(previewRule, /cursor:default/);
});

test('long project names enlarge their collapsed row instead of showing a textarea scrollbar', () => {
  const {body, find, storage} = setup();
  const row = body.children[0];
  const name = find(row, node => node.tagName === 'textarea' && node.attributes['aria-label'] === '案件名');
  assert.ok(name);
  Object.defineProperty(name, 'scrollHeight', {configurable: true, value: 92});
  name.value = '日本語が長く折り返される案件名の例';
  name.dispatch('input');
  assert.equal(row.style.height, '92px');
  assert.match(html, /\.entry-table \.root-cell \.entry-editor-text>textarea\.control\{[^}]*overflow-y:hidden/);
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.value, name.value);
});

test('project rows keep tight spacing while allowing expanded detail and 1:N controls', () => {
  const {body, find} = setup();
  assert.equal(body.children[0].style.height, '64px', 'collapsed row uses the compact baseline');
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.equal(body.children[0].style.height, '104px', 'expanded row no longer reserves 160px');
  assert.match(html, /\.entry-table tbody tr\{height:104px\}/, 'child rows also use a compact default');
  const baseChoice = html.match(/\.entry-table \.entry-editor-choice\{([^}]+)\}/)?.[1] || '';
  assert.match(baseChoice, /min-height:104px/);
  const collapsedChoice = html.match(/\.entry-table tr\.project-collapsed \.entry-editor-choice\{([^}]+)\}/)?.[1] || '';
  assert.match(collapsedChoice, /min-height:64px/);
  const finalChoice = [...html.matchAll(/\.entry-table \.entry-editor-choice\{([^}]+)\}/g)].at(-1)?.[1] || '';
  assert.match(finalChoice, /padding:5px 5px 6px/);
  assert.match(html, /\.entry-table \.entry-editor-choice:has\(>\.cell-entry-actions\)\{padding-bottom:28px\}/);
  const expandedDetail = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.getAttribute('data-autosize-detail') === 'true');
  assert.equal(expandedDetail.hidden, false, 'full detail remains available in expanded rows');
  assert.ok(find(body.children[0], node => node.tagName === 'button' && node.textContent === '＋'), 'add controls remain');
});

test('expanded project has a slim left accent without a new row background', () => {
  const accent = html.match(/\.entry-table tr\.project-expanded \.root-cell::before\{([^}]+)\}/)?.[1];
  assert.ok(accent, 'project accent is scoped to the expanded root cell');
  assert.match(accent, /left:0/);
  assert.match(accent, /width:3px/);
  assert.match(accent, /background:#3d8b98/);
  const {body, find} = setup();
  assert.match(body.children[0].className, /project-collapsed/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.match(body.children[1].className, /project-collapsed/);
  assert.doesNotMatch(accent, /background-color:/);
});

test('input project separators and editor spacing are subtle and consistent', () => {
  assert.match(html, /\.entry-table tbody td\{border-right-color:#e5edf3\}/);
  const firstRows = [...html.matchAll(/\.entry-table tr\.project-first>td\{([^}]+)\}/g)];
  assert.match(firstRows.at(-1)?.[1] || '', /border-top-color:#afc4d8/);
  const followRows = [...html.matchAll(/\.entry-table tr\.detail-follow>td\{([^}]+)\}/g)];
  assert.match(followRows.at(-1)?.[1] || '', /border-top-color:#e8eef5/);
  const editorRules = [...html.matchAll(/\.entry-table \.entry-editor-choice\{([^}]+)\}/g)];
  assert.match(editorRules.at(-1)?.[1] || '', /padding:5px 5px 6px/);
});

test('filter editors use the Google filter_alt symbol in borderless compact controls', () => {
  const {body, find} = setup();
  const single = find(body.children[0].children[1], node => node.tagName === 'summary');
  const multiple = find(body.children[0].children[2], node => node.tagName === 'summary');
  for (const control of [single, multiple]) {
    assert.ok(control);
    const glyph = find(control, node => node.className === 'filter-alt-icon');
    assert.ok(glyph, 'the editing affordance is a filter icon');
    assert.equal(glyph.getAttribute('aria-hidden'), 'true');
  }
  const buttonRule = [...html.matchAll(/\.entry-table \.multi-picker>summary\{([^}]+)\}/g)].map(match => match[1]).find(rule => rule.includes('width:20px')) || '';
  assert.match(buttonRule, /width:20px/);
  assert.match(buttonRule, /height:20px/);
  assert.match(buttonRule, /border:0/);
  assert.match(buttonRule, /background:#f1f3f5/);
  assert.match(html, /filter_alt_20px\.svg/);
  assert.match(html, /mask:var\(--filter-alt-glyph\)/);
});

test('project expand and collapse controls show only a simple glyph with no frame', () => {
  const {body, find} = setup();
  const collapsed = find(body.children[0], node => node.className === 'project-row-toggle');
  assert.equal(collapsed?.textContent, '＞');
  collapsed.dispatch('click');
  const expanded = find(body.children[0], node => node.className === 'project-row-toggle');
  assert.equal(expanded?.textContent, '⋁');
  const rule = [...html.matchAll(/\.project-row-toggle\{([^}]+)\}/g)].at(-1)?.[1] || '';
  assert.match(rule, /border:0/);
  assert.match(rule, /background:transparent/);
  assert.match(rule, /font-size:12px/);
  assert.match(rule, /width:17px/);
  assert.match(html, /\.project-row-toggle:hover\{background:transparent/);
});

test('dropdown options escape the scrolling table and open upward near the viewport bottom', () => {
  const {body, find} = setup();
  const picker = find(body.children[1].children[2], node => node.tagName === 'details' && node.className === 'multi-picker');
  const trigger = find(picker, node => node.tagName === 'summary');
  const popup = find(picker, node => node.className?.includes?.('choice-popover'));
  assert.ok(popup, 'options use a dedicated top-layer popover');
  assert.equal(popup.getAttribute('popover'), 'auto');
  trigger.rect = {top: 635, bottom: 655, left: 350, right: 370, width: 20, height: 20};
  popup.rect = {top: 0, bottom: 220, left: 0, right: 200, width: 200, height: 220};
  picker.open = true;
  picker.dispatch('toggle');
  assert.equal(popup.popoverOpen, true, 'popover enters the top layer');
  assert.ok(Number.parseFloat(popup.style.top) < trigger.rect.top, 'opens above near bottom');
  assert.equal(popup.style.position, 'fixed');
  popup.dispatch('toggle', {newState: 'closed'});
  assert.equal(picker.open, false, 'outside click also closes the picker');
});
