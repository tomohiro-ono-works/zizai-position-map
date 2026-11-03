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
  dispatch(name) { this.handlers[name]?.({target: this}); }
  querySelector(name) { return name === '.table-wrap' ? this.scrollArea : null; }
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
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  getElement('table-input').scrollArea = new Element();
  for (const view of ['definition', 'input', 'analysis']) {
    navigation[view] = new Element('button');
    navigation[view].dataset.viewTab = view;
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
      return match ? navigation[match[1]] : new Element();
    },
    querySelectorAll: selector => selector === '[data-view-tab]' ? Object.values(navigation) : []
  };
  const context = {
    document,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    structuredClone, Date, Math, JSON, Set, Map, console,
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
  return {body: getElement('entry-body'), find, storage, navigation, getElement, context};
}

test('projects are initially collapsed and expand independently without changing their data', () => {
  const {body, find, storage} = setup();
  assert.equal(body.children.length, 2);
  for (const row of body.children) {
    assert.match(row.className, /project-collapsed/);
    assert.equal(find(row, node => node.className === 'detail-message-wrap')?.hidden, true);
  }
  const openFirst = find(body.children[0], node => node.tagName === 'button' && node.textContent === '▶');
  assert.ok(openFirst, 'project title includes an expand button');
  assert.equal(openFirst.getAttribute('aria-expanded'), 'false');
  openFirst.dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.equal(find(body.children[0], node => node.className === 'detail-message-wrap')?.hidden, false);
  assert.match(body.children[1].className, /project-collapsed/);
  find(body.children[1], node => node.tagName === 'button' && node.textContent === '▶').dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.match(body.children[1].className, /project-expanded/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '▼').dispatch('click');
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

test('single selection is shown as a label and edited only through the arrow', () => {
  const {body, find, storage} = setup();
  const stageCell = body.children[0].children[1];
  const label = find(stageCell, node => node.className === 'choice-chip');
  assert.equal(label?.textContent, '設計');
  const select = find(stageCell, node => node.tagName === 'select');
  assert.equal(select?.hidden, true);
  const edit = find(stageCell, node => node.tagName === 'button' && node.textContent === '▼');
  assert.ok(edit, 'the editor has a dedicated arrow');
  edit.dispatch('click');
  assert.equal(select.hidden, false);
  select.value = '評価';
  select.dispatch('change');
  const changed = find(body.children[0].children[1], node => node.className === 'choice-chip');
  assert.equal(changed?.textContent, '評価');
  assert.equal(find(body.children[0].children[1], node => node.tagName === 'select')?.hidden, true);
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
  assert.equal(edit?.textContent, '▼');
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

test('expanded detail messages grow with content instead of scrolling inside a cell', () => {
  const {body, find, storage} = setup(true);
  const firstRow = body.children[0];
  const detailWrap = find(firstRow.children[1], node => node.className === 'detail-message-wrap');
  assert.equal(detailWrap.hidden, true);
  find(firstRow, node => node.tagName === 'button' && node.textContent === '▶').dispatch('click');
  const detail = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  assert.ok(detail, 'details stay under their existing column');
  assert.equal(detail.getAttribute('data-autosize-detail'), 'true');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  const contents = '要件と設計の記録を詳細に残します。'.repeat(24);
  detail.value = contents;
  detail.dispatch('input');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.children[0].detail, contents);
  Object.defineProperty(detail, 'scrollHeight', {configurable: true, value: undefined});
  detail.dispatch('input');
  assert.equal(detail.style.height, '65px', 'unknown size falls back to a usable minimum');
  const rules = [...html.matchAll(/\.entry-table \.entry-editor-choice \.detail-message-wrap textarea\.control\{([^}]+)\}/g)];
  const finalRule = rules.at(-1)?.[1] || '';
  assert.match(finalRule, /overflow:hidden/);
  assert.match(finalRule, /flex:none/);
  assert.match(finalRule, /resize:none/);
});

test('expanded project has a slim left accent without a new row background', () => {
  const accent = html.match(/\.entry-table tr\.project-expanded \.root-cell::before\{([^}]+)\}/)?.[1];
  assert.ok(accent, 'project accent is scoped to the expanded root cell');
  assert.match(accent, /left:0/);
  assert.match(accent, /width:3px/);
  assert.match(accent, /background:#3d8b98/);
  const {body, find} = setup();
  assert.match(body.children[0].className, /project-collapsed/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '▶').dispatch('click');
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
  assert.match(editorRules.at(-1)?.[1] || '', /padding:6px 7px 29px/);
});
