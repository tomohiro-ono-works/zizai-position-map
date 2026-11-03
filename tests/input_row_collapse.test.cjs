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
}

function setup() {
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
    {id: 'stage', name: '業務の上位工程', type: 'select', cardinality: '1:1', options: ['設計', '評価'], allowDetail: true},
    {id: 'tech', name: '技術の高度化', type: 'multiselect', cardinality: '1:N', options: ['統計', '機械学習'], allowDetail: true}
  ];
  const projects = [
    {id: 'p1', data: {name: '案件A', stage: '設計', tech: ['統計']}},
    {id: 'p2', data: {name: '案件B', stage: '評価', tech: ['機械学習']}}
  ];
  const storage = new Map([['dx_three_screens_v2', JSON.stringify({detailUiVersion: 1, columns, projects})]]);
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
  vm.runInNewContext(scripts.join('\n'), {
    document,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    structuredClone, Date, Math, JSON, Set, Map, console,
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true
  });
  navigation.input.dispatch('click');
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  };
  return {body: getElement('entry-body'), find, storage};
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
